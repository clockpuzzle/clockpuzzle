/* clock-puzzles-shop / app.js */

/* ===== CONFIG ===== */
var GCS = 'https://storage.googleapis.com/stakco-images';
var PLAY = 'https://play.stakcos.com';
var UID = '109208089060140847827';
var PRICE = 24.99;
var STRIPE_EP = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3001/api/checkout'
  : 'https://api.stakcos.com/api/checkout';
var SHIPPING = 5, FREE_SHIP = 80, TAX = 0.09;
var CART_KEY = 'cp_cart', CUST_KEY = 'cp_customer', THEME_KEY = 'cp_theme';
var COUNTRIES = {
  SG:'Singapore',MY:'Malaysia',ID:'Indonesia',TH:'Thailand',PH:'Philippines',
  VN:'Vietnam',IN:'India',LK:'Sri Lanka',AU:'Australia',NZ:'New Zealand',
  JP:'Japan',KR:'South Korea',US:'United States',GB:'United Kingdom',
  CA:'Canada',DE:'Germany',FR:'France',OTHER:'Other'
};

/* ===== THEME ===== */
function getTheme() { return localStorage.getItem(THEME_KEY) || 'dark'; }
function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); localStorage.setItem(THEME_KEY, t); }
function toggleTheme() { applyTheme(getTheme() === 'dark' ? 'light' : 'dark'); }
applyTheme(getTheme());

/* ===== GCS HELPERS ===== */
function getLayers(id) {
  var m = id.match(/_(\d+)$/);
  if (m) { var n = +m[1]; if (n >= 2 && n <= 6) return n; }
  return 2;
}
function imgBase(id) { return id.replace(/_\d+$/, ''); }
function layerUrl(u, id) { return GCS + '/' + u + '/' + id + '/' + imgBase(id) + '_0.png'; }
function thumbUrl(u, id) { return GCS + '/' + u + '/' + id + '/' + imgBase(id) + '_0_thumb.png'; }
function puzzleImgUrls(u, id) {
  var b = imgBase(id), n = getLayers(id), urls = [];
  for (var i = 0; i < n; i++) urls.push(GCS + '/' + u + '/' + id + '/' + b + '_' + i + '.png');
  return urls;
}
function fmtName(id, title) {
  if (title && title.trim()) return title.trim();
  var r = id.replace(/_\d+$/, '');
  var p = r.replace(/_/g, ' ').split(' ').filter(function(w) {
    return !/^\d{4}-\d{2}-\d{2}$/.test(w) && !/^\d{9,}$/.test(w);
  });
  return p.length ? p.map(function(w) { return w[0].toUpperCase() + w.slice(1).toLowerCase(); }).join(' ') : '';
}
function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

/* ===== DATA LOADING ===== */
async function fetchJson(url) {
  var r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function loadAlbums() {
  var uc = await fetchJson(GCS + '/' + UID + '/user.config');
  var ids = uc.Albums || [];
  if (!ids.length) return [];
  var results = await Promise.all(ids.map(async function(aid) {
    try {
      var a = await fetchJson(GCS + '/' + UID + '/' + aid + '.album.json');
      var nm = a.Name || a.Id;
      return {
        id: a.Id, name: nm,
        puzzles: (a.Puzzles || []).sort(function(x, y) { return x.Index - y.Index; }).map(function(p, i) {
          return {
            puzzleId: p.PuzzleId,
            name: fmtName(p.PuzzleId, p.Title) || nm + ' #' + (i + 1),
            layers: getLayers(p.PuzzleId),
            price: PRICE,
            thumbnail: layerUrl(UID, p.PuzzleId),
            thumbSmall: thumbUrl(UID, p.PuzzleId),
            albumName: nm
          };
        })
      };
    } catch (e) { return null; }
  }));
  return results.filter(Boolean);
}

/* =========================================================
   PUZZLE PLAYER ENGINE (self-contained, no external deps)
   ========================================================= */
function PuzzlePlayer(container, imageUrls, opts) {
  var self = this;
  opts = opts || {};
  self.tolerance = opts.tolerance || 4;
  self.layers = [];
  self.active = 0;
  self.solved = false;
  self.rafId = null;

  container.innerHTML = '';
  var wrap = document.createElement('div');
  wrap.className = 'pz-wrap';
  var indRing = document.createElement('div');
  indRing.className = 'pz-indicators';
  var count = imageUrls.length;
  var offsets = _genOffsets(count);

  for (var i = 0; i < count; i++) {
    var rot = 30 + Math.floor(Math.random() * 300);
    var el = document.createElement('div');
    el.className = 'pz-layer';
    el.style.transform = 'rotate(' + rot + 'deg)';
    wrap.appendChild(el);

    var bub = document.createElement('div');
    bub.className = 'pz-bubble' + (i === 0 ? ' active' : '');
    bub.textContent = String(i + 1);
    indRing.appendChild(bub);

    self.layers.push({ rotation: rot, el: el, ind: bub, offset: offsets[i] });
    _bindBubble(self, bub, i);
  }

  container.appendChild(wrap);
  container.appendChild(indRing);
  self.wrap = wrap;
  self.indRing = indRing;
  _loadImgs(self, imageUrls);
  _bindDrag(self, wrap);
  _startSync(self, wrap);

  self.destroy = function() { if (self.rafId) cancelAnimationFrame(self.rafId); };
}

function _genOffsets(n) {
  var o = [], min = 60;
  for (var i = 0; i < n; i++) {
    var v, t = 0;
    do { v = Math.floor(Math.random() * 360); t++; }
    while (t < 50 && o.some(function(x) { var d = Math.abs(v - x); return Math.min(d, 360 - d) < min; }));
    o.push(v);
  }
  return o;
}

function _loadImgs(p, urls) {
  var loaded = 0, ok = 0, n = urls.length;
  urls.forEach(function(url, i) {
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() {
      p.layers[i].el.style.backgroundImage = 'url(' + url + ')';
      ok++; loaded++;
      if (loaded === n && ok > 0) p.wrap.classList.add('loaded');
    };
    img.onerror = function() {
      loaded++;
      if (loaded === n && ok > 0) p.wrap.classList.add('loaded');
    };
    img.src = url;
  });
}

function _bindBubble(p, bub, idx) {
  var dragging = false, startX, startY, dragA, TH = 5;
  bub.addEventListener('pointerdown', function(e) {
    if (p.solved) return;
    e.stopPropagation(); e.preventDefault();
    bub.setPointerCapture(e.pointerId);
    dragging = false; startX = e.clientX; startY = e.clientY;
    dragA = _angleFrom(p, e.clientX, e.clientY);
    bub.classList.add('dragging');
  }, { passive: false });
  bub.addEventListener('pointermove', function(e) {
    if (!bub.hasPointerCapture(e.pointerId) || p.solved) return;
    var dx = e.clientX - startX, dy = e.clientY - startY;
    if (!dragging && Math.sqrt(dx * dx + dy * dy) > TH) { dragging = true; _selectLayer(p, idx); }
    if (dragging) {
      var cur = _angleFrom(p, e.clientX, e.clientY), delta = cur - dragA;
      if (delta > 180) delta -= 360; if (delta < -180) delta += 360;
      _rotateLayer(p, idx, delta); dragA = cur;
    }
  }, { passive: false });
  bub.addEventListener('pointerup', function() {
    bub.classList.remove('dragging');
    if (!dragging) _selectLayer(p, idx); else _checkSolve(p);
  });
  bub.addEventListener('pointercancel', function() { bub.classList.remove('dragging'); });
}

function _bindDrag(p, el) {
  var dragging = false, lastA = 0;
  function start(x, y) { if (p.solved) return; dragging = true; lastA = _angleFrom(p, x, y); p.wrap.classList.add('grabbing'); }
  function move(x, y) {
    if (!dragging || p.solved) return;
    var cur = _angleFrom(p, x, y), d = cur - lastA;
    if (d > 180) d -= 360; if (d < -180) d += 360;
    _rotateLayer(p, p.active, d); lastA = cur;
  }
  function end() { if (!dragging) return; dragging = false; p.wrap.classList.remove('grabbing'); _checkSolve(p); }
  el.addEventListener('mousedown', function(e) { e.preventDefault(); start(e.clientX, e.clientY); });
  document.addEventListener('mousemove', function(e) { if (dragging) { e.preventDefault(); move(e.clientX, e.clientY); } });
  document.addEventListener('mouseup', end);
  el.addEventListener('touchstart', function(e) { e.preventDefault(); var t = e.touches[0]; start(t.clientX, t.clientY); }, { passive: false });
  document.addEventListener('touchmove', function(e) { if (dragging) { e.preventDefault(); var t = e.touches[0]; move(t.clientX, t.clientY); } }, { passive: false });
  document.addEventListener('touchend', end);
  el.addEventListener('wheel', function(e) { if (p.solved) return; e.preventDefault(); _rotateLayer(p, p.active, e.deltaY > 0 ? 3 : -3); _checkSolve(p); }, { passive: false });
}

function _startSync(p, wrap) {
  function sync() {
    var r = wrap.getBoundingClientRect();
    var rad = r.width / 2, cx = r.width / 2, cy = r.height / 2;
    var bs = Math.max(16, Math.min(44, r.width * .12));
    var fs = Math.max(9, bs * .45);
    p.layers.forEach(function(l) {
      var a = (l.rotation + l.offset - 90) * Math.PI / 180;
      l.ind.style.left = cx + rad * Math.cos(a) + 'px';
      l.ind.style.top = cy + rad * Math.sin(a) + 'px';
      l.ind.style.width = l.ind.style.height = bs + 'px';
      l.ind.style.fontSize = fs + 'px';
    });
    p.rafId = requestAnimationFrame(sync);
  }
  p.rafId = requestAnimationFrame(sync);
}

function _selectLayer(p, idx) {
  p.active = idx;
  p.layers.forEach(function(l, i) { l.ind.classList.toggle('active', i === idx); });
}
function _rotateLayer(p, idx, delta) {
  var l = p.layers[idx]; if (!l) return;
  l.rotation += delta;
  l.el.style.transform = 'rotate(' + l.rotation + 'deg)';
}
function _angleFrom(p, cx, cy) {
  var r = p.wrap.getBoundingClientRect();
  return Math.atan2(cy - (r.top + r.height / 2), cx - (r.left + r.width / 2)) * 180 / Math.PI;
}
function _checkSolve(p) {
  if (p.solved) return;
  var tol = p.tolerance;
  var norms = p.layers.map(function(l) { return ((l.rotation % 360) + 360) % 360; });
  var ref = norms[0];
  if (norms.every(function(n) { var d = Math.abs(n - ref); return Math.min(d, 360 - d) <= tol; })) {
    p.solved = true; _animSolve(p);
  }
}
function _animSolve(p) {
  var ref = p.layers[0].rotation;
  p.layers.forEach(function(l) {
    l.el.style.transition = 'transform .4s ease-out';
    l.rotation = ref;
    l.el.style.transform = 'rotate(' + ref + 'deg)';
  });
  setTimeout(function() {
    var deg = ((ref % 360) + 360) % 360;
    if (deg > 180) deg -= 360;
    p.layers.forEach(function(l) {
      l.el.style.transition = 'none';
      l.el.style.transform = 'rotate(' + deg + 'deg)';
      l.el.getBoundingClientRect();
      l.el.style.transition = 'transform 2s ease-in-out';
      l.rotation = 0;
      l.el.style.transform = 'rotate(0deg)';
    });
    p.indRing.classList.add('pz-solved');
    if (p.rafId) { cancelAnimationFrame(p.rafId); p.rafId = null; }
  }, 500);
}

/* ===== PLAYER INSTANCES ===== */
var featuredPlayer = null, modalPlayer = null;

function openPlayer(puzzle) {
  if (modalPlayer) { modalPlayer.destroy(); modalPlayer = null; }
  document.getElementById('player-title').textContent = puzzle.name;
  var ct = document.getElementById('player-container');
  ct.innerHTML = '';
  modalPlayer = new PuzzlePlayer(ct, puzzleImgUrls(UID, puzzle.puzzleId));
  document.getElementById('player-buy').onclick = function() { addToCart(puzzle); closePlayer(); };
  document.getElementById('player-overlay').classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closePlayer() {
  document.getElementById('player-overlay').classList.remove('active');
  document.body.style.overflow = '';
  if (modalPlayer) { modalPlayer.destroy(); modalPlayer = null; }
}
document.getElementById('player-overlay').addEventListener('click', function(e) { if (e.target === e.currentTarget) closePlayer(); });
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closePlayer(); });

/* ===== CART ===== */
function loadCart() { try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch (e) { return []; } }
function saveCart(c) { localStorage.setItem(CART_KEY, JSON.stringify(c)); updateBadge(); }
function addToCart(p) {
  var c = loadCart(), idx = c.findIndex(function(i) { return i.puzzleId === p.puzzleId; });
  if (idx >= 0) c[idx].qty++;
  else c.push({ puzzleId: p.puzzleId, name: p.name, layers: p.layers, price: p.price, thumbSmall: p.thumbSmall, albumName: p.albumName, qty: 1 });
  saveCart(c); showToast(p.name + ' added to cart');
}
function updateQty(id, d) {
  var c = loadCart(), idx = c.findIndex(function(i) { return i.puzzleId === id; });
  if (idx < 0) return; c[idx].qty += d; if (c[idx].qty <= 0) c.splice(idx, 1);
  saveCart(c); renderCart();
}
function removeFromCart(id) { saveCart(loadCart().filter(function(i) { return i.puzzleId !== id; })); renderCart(); }
function clearCartAll() { saveCart([]); renderCart(); }
function cartCount() { return loadCart().reduce(function(s, i) { return s + i.qty; }, 0); }
function cartSubtotal() { return loadCart().reduce(function(s, i) { return s + i.price * i.qty; }, 0); }
function updateBadge() { var b = document.getElementById('cart-badge'), n = cartCount(); b.textContent = n; b.classList.toggle('visible', n > 0); }

/* ===== CUSTOMER ===== */
function loadCust() { try { return JSON.parse(localStorage.getItem(CUST_KEY)) || {}; } catch (e) { return {}; } }
function saveCust(d) { localStorage.setItem(CUST_KEY, JSON.stringify(d)); }

/* ===== VIEWS ===== */
var allPuzzles = [], puzzleMap = {};
function showView(nm) {
  document.querySelectorAll('.page-view').forEach(function(v) { v.classList.remove('active'); });
  var el = document.getElementById('view-' + nm);
  if (el) el.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (nm === 'cart') renderCart();
}

/* ===== RENDER FEATURED ===== */
function renderFeatured(p) {
  if (featuredPlayer) { featuredPlayer.destroy(); featuredPlayer = null; }
  var el = document.getElementById('featured-puzzle');
  el.innerHTML =
    '<div class="featured-card">' +
      '<div style="padding:8px"><div class="featured-player-wrap" id="feat-player"></div></div>' +
      '<div class="featured-body">' +
        '<div class="featured-name">' + esc(p.name) + '</div>' +
        '<div class="featured-footer">' +
          '<div class="featured-price"><span class="currency">S$</span>' + p.price.toFixed(2) + '</div>' +
          '<div class="featured-actions">' +
            '<button class="btn btn-buy" id="feat-cart">Add to Cart</button>' +
            '<button class="btn btn-play" id="feat-try">&#9654; Try it</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  featuredPlayer = new PuzzlePlayer(document.getElementById('feat-player'), puzzleImgUrls(UID, p.puzzleId));
  document.getElementById('feat-cart').onclick = function() { addToCart(puzzleMap[p.puzzleId]); };
  document.getElementById('feat-try').onclick = function() { openPlayer(p); };
}

/* ===== RENDER ALBUM ===== */
function renderAlbum(album, skipId) {
  var pzs = album.puzzles.filter(function(p) { return p.puzzleId !== skipId; });
  if (!pzs.length) return '';
  var cards = pzs.map(function(p) {
    return '<div class="puzzle-card" data-id="' + esc(p.puzzleId) + '">' +
      '<div class="card-image">' +
        '<img src="' + p.thumbSmall + '" alt="' + esc(p.name) + '" loading="lazy" onerror="this.onerror=null;this.parentElement.innerHTML=\'<div class=img-fallback>&#129513;</div>\'">' +
        '<span class="card-layers-badge">' + p.layers + 'L</span>' +
      '</div>' +
      '<div class="card-body">' +
        '<div class="card-name">' + esc(p.name) + '</div>' +
        '<div class="card-footer">' +
          '<div class="card-price"><span class="currency">S$</span>' + p.price.toFixed(2) + '</div>' +
          '<div class="card-actions">' +
            '<button class="btn btn-buy btn-sm" data-action="cart">Add to Cart</button>' +
            '<button class="btn btn-play btn-sm" data-action="play">&#9654; Try</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
  return '<section class="album-section"><div class="container">' +
    '<div class="album-header"><h2 class="album-title">' + esc(album.name) + '<span class="album-label">collection</span></h2>' +
    '<span class="album-count">' + pzs.length + ' puzzle' + (pzs.length !== 1 ? 's' : '') + '</span></div>' +
    '<div class="puzzles-grid">' + cards + '</div>' +
  '</div></section>';
}

/* ===== RENDER CART ===== */
function renderCart() {
  var items = loadCart(), el = document.getElementById('cart-content');
  if (!items.length) {
    el.innerHTML = '<div class="cart-empty"><p>Your cart is empty</p><button class="btn btn-buy" onclick="showView(\'shop\')">Browse Puzzles</button></div>';
    return;
  }
  var sub = cartSubtotal(), ship = sub >= FREE_SHIP ? 0 : SHIPPING;
  var tax = +(sub * TAX).toFixed(2), total = +(sub + ship + tax).toFixed(2);
  var c = loadCust();
  var cOk = !!(c.email && c.name && c.phone);
  var sOk = !!(c.address1 && c.city && c.postal && c.country);
  var cn = COUNTRIES[c.country] || '';
  var co = Object.keys(COUNTRIES).map(function(k) { return '<option value="' + k + '"' + (c.country === k ? ' selected' : '') + '>' + COUNTRIES[k] + '</option>'; }).join('');

  var cartHtml = items.map(function(i) {
    return '<div class="cart-item"><div class="cart-item-img"><img src="' + i.thumbSmall + '" alt=""></div>' +
      '<div class="cart-item-info"><div class="cart-item-name">' + esc(i.name) + '</div>' +
      '<div class="cart-item-meta">' + esc(i.albumName) + '</div>' +
      '<div class="cart-item-bottom"><div class="cart-item-price">S$' + (i.price * i.qty).toFixed(2) + '</div>' +
      '<div style="display:flex;align-items:center;gap:8px">' +
        '<div class="cart-item-qty"><button onclick="updateQty(\'' + i.puzzleId + '\',-1)">&minus;</button><span>' + i.qty + '</span><button onclick="updateQty(\'' + i.puzzleId + '\',1)">+</button></div>' +
        '<button class="cart-item-remove" onclick="removeFromCart(\'' + i.puzzleId + '\')"><i class="fa-regular fa-trash-can"></i></button>' +
      '</div></div></div></div>';
  }).join('');

  var contactHtml = '<div class="sidebar-card"><div class="collapsible-header" onclick="toggleSection(\'contact\')"><h3><i class="fa-regular fa-user"></i> Contact Details</h3><span class="toggle-icon' + (cOk ? ' collapsed' : '') + '" id="contact-toggle"><i class="fa-solid fa-chevron-down"></i></span></div><div class="collapsible-summary' + (cOk ? ' visible' : '') + '" id="contact-summary"><i class="fa-solid fa-circle-check"></i> ' + esc(c.name) + ' \u00b7 ' + esc(c.email) + ' \u00b7 ' + esc(c.phone) + '</div><div class="collapsible-body' + (cOk ? ' collapsed' : '') + '" id="contact-body"><div class="form-field"><label>Email *</label><input type="email" id="c-email" placeholder="you@example.com" value="' + esc(c.email || '') + '" autocomplete="email"></div><div class="form-field"><label>Full Name *</label><input type="text" id="c-name" placeholder="Your full name" value="' + esc(c.name || '') + '" autocomplete="name"></div><div class="form-field"><label>Phone *</label><input type="tel" id="c-phone" placeholder="+65 9123 4567" value="' + esc(c.phone || '') + '" autocomplete="tel"></div></div></div>';

  var shipHtml = '<div class="sidebar-card"><div class="collapsible-header" onclick="toggleSection(\'shipping\')"><h3><i class="fa-solid fa-truck-fast"></i> Shipping Address</h3><span class="toggle-icon' + (sOk ? ' collapsed' : '') + '" id="shipping-toggle"><i class="fa-solid fa-chevron-down"></i></span></div><div class="collapsible-summary' + (sOk ? ' visible' : '') + '" id="shipping-summary"><i class="fa-solid fa-circle-check"></i> ' + esc(c.address1 || '') + (c.city ? ', ' + esc(c.city) : '') + (c.postal ? ' ' + esc(c.postal) : '') + (cn ? ' \u00b7 ' + cn : '') + '</div><div class="collapsible-body' + (sOk ? ' collapsed' : '') + '" id="shipping-body"><div class="form-field"><label>Address Line 1 *</label><input type="text" id="c-addr1" placeholder="Block, street, unit" value="' + esc(c.address1 || '') + '" autocomplete="address-line1"></div><div class="form-field"><label>Address Line 2</label><input type="text" id="c-addr2" placeholder="Apartment, floor (optional)" value="' + esc(c.address2 || '') + '" autocomplete="address-line2"></div><div class="form-row"><div class="form-field"><label>City *</label><input type="text" id="c-city" placeholder="Singapore" value="' + esc(c.city || '') + '" autocomplete="address-level2"></div><div class="form-field"><label>Postal Code *</label><input type="text" id="c-postal" placeholder="123456" value="' + esc(c.postal || '') + '" autocomplete="postal-code"></div></div><div class="form-field"><label>Country *</label><select id="c-country" autocomplete="country"><option value="">Select country</option>' + co + '</select></div></div></div>';

  var sumHtml = '<div class="sidebar-card"><h3>Order Summary</h3>' +
    '<div class="summary-row"><span>Subtotal (' + items.reduce(function(s, i) { return s + i.qty; }, 0) + ' items)</span><span>S$' + sub.toFixed(2) + '</span></div>' +
    '<div class="summary-row"><span>Shipping</span><span>' + (ship === 0 ? '<span style="color:var(--green)">Free</span>' : 'S$' + ship.toFixed(2)) + '</span></div>' +
    (sub < FREE_SHIP ? '<div style="font-size:10px;color:var(--text-muted);text-align:right;margin-top:-4px">Free over S$' + FREE_SHIP + '</div>' : '') +
    '<div class="summary-row"><span>GST (' + (TAX * 100) + '%)</span><span>S$' + tax.toFixed(2) + '</span></div>' +
    '<div class="summary-row total"><span>Total</span><span class="summary-val">S$' + total.toFixed(2) + '</span></div>' +
    '<button class="checkout-btn" id="checkout-btn" onclick="handleCheckout()">Checkout \u2014 S$' + total.toFixed(2) + '</button>' +
    '<div class="checkout-note">Secure checkout powered by Stripe.</div>' +
    '<button class="clear-cart-link" onclick="if(confirm(\'Clear all items?\'))clearCartAll()">Clear cart</button></div>';

  el.innerHTML = '<div class="cart-layout"><div class="cart-items">' + cartHtml + '</div><div class="cart-sidebar">' + contactHtml + shipHtml + sumHtml + '</div></div>';
  document.querySelectorAll('[id^="c-"]').forEach(function(inp) {
    inp.addEventListener('blur', saveCustFields);
    inp.addEventListener('change', saveCustFields);
  });
}

/* ===== CUSTOMER SAVE / COLLAPSIBLE ===== */
function saveCustFields() {
  function g(id) { return (document.getElementById(id) || {}).value || ''; }
  saveCust({
    email: g('c-email').trim(), name: g('c-name').trim(), phone: g('c-phone').trim(),
    address1: g('c-addr1').trim(), address2: g('c-addr2').trim(),
    city: g('c-city').trim(), postal: g('c-postal').trim(), country: g('c-country')
  });
  var c = loadCust();
  if (c.email && c.name && c.phone) collapseSection('contact');
  if (c.address1 && c.city && c.postal && c.country) collapseSection('shipping');
}

function toggleSection(sec) {
  var body = document.getElementById(sec + '-body');
  var tog = document.getElementById(sec + '-toggle');
  var sum = document.getElementById(sec + '-summary');
  if (!body) return;
  if (body.classList.contains('collapsed')) {
    body.classList.remove('collapsed'); tog.classList.remove('collapsed');
    if (sum) sum.classList.remove('visible');
  } else {
    saveCustFields();
    body.classList.add('collapsed'); tog.classList.add('collapsed');
    var c = loadCust();
    if (sec === 'contact' && sum) {
      sum.innerHTML = '<i class="fa-solid fa-circle-check"></i> ' + esc(c.name || '\u2014') + ' \u00b7 ' + esc(c.email || '\u2014') + ' \u00b7 ' + esc(c.phone || '\u2014');
      sum.classList.add('visible');
    }
    if (sec === 'shipping' && sum) {
      sum.innerHTML = '<i class="fa-solid fa-circle-check"></i> ' + esc(c.address1 || '\u2014') + (c.city ? ', ' + esc(c.city) : '') + (c.postal ? ' ' + esc(c.postal) : '') + (COUNTRIES[c.country] ? ' \u00b7 ' + COUNTRIES[c.country] : '');
      sum.classList.add('visible');
    }
  }
}

function collapseSection(sec) {
  var body = document.getElementById(sec + '-body');
  var tog = document.getElementById(sec + '-toggle');
  var sum = document.getElementById(sec + '-summary');
  if (!body || body.classList.contains('collapsed')) return;
  body.classList.add('collapsed');
  if (tog) tog.classList.add('collapsed');
  if (sum) sum.classList.add('visible');
}

function validateCust() {
  var c = loadCust(), m = [];
  if (!c.email || c.email.indexOf('@') < 0) m.push('email');
  if (!c.name) m.push('full name');
  if (!c.phone) m.push('phone');
  if (!c.address1) m.push('address');
  if (!c.city) m.push('city');
  if (!c.postal) m.push('postal code');
  if (!c.country) m.push('country');
  return m;
}

/* ===== CHECKOUT ===== */
async function handleCheckout() {
  saveCustFields();
  var missing = validateCust();
  if (missing.length) {
    var cF = ['email', 'full name', 'phone'], sF = ['address', 'city', 'postal code', 'country'];
    if (missing.some(function(m) { return cF.indexOf(m) >= 0; })) {
      var b = document.getElementById('contact-body');
      if (b && b.classList.contains('collapsed')) toggleSection('contact');
    }
    if (missing.some(function(m) { return sF.indexOf(m) >= 0; })) {
      var b2 = document.getElementById('shipping-body');
      if (b2 && b2.classList.contains('collapsed')) toggleSection('shipping');
    }
    showToast('Please fill: ' + missing.join(', '));
    return;
  }
  var c = loadCust(), items = loadCart(), btn = document.getElementById('checkout-btn');
  btn.disabled = true; btn.textContent = 'Creating checkout...';
  try {
    var res = await fetch(STRIPE_EP, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: c.email, customerName: c.name, phone: c.phone,
        items: items.map(function(i) { return { puzzleId: i.puzzleId, name: i.name, layers: i.layers, price: i.price, qty: i.qty }; }),
        shippingAddress: { name: c.name, address1: c.address1, address2: c.address2 || '', city: c.city, postalCode: c.postal, country: c.country, phone: c.phone }
      })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var session = await res.json(), url = (session.data && session.data.url) || session.url;
    if (url) { window.location.href = url; return; }
    throw new Error('No URL');
  } catch (e) {
    console.error('Checkout:', e);
    showToast('Checkout coming soon \u2014 email hello@stakcos.com to order!');
    btn.disabled = false; btn.textContent = 'Checkout';
  }
}

/* ===== TOAST ===== */
function showToast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function() { t.classList.remove('show'); }, 3500);
}

/* ===== CHECKOUT RESULT HANDLING ===== */
function handleCheckoutResult() {
  var params = new URLSearchParams(window.location.search);
  var checkoutStatus = params.get('checkout');
  var orderId = params.get('order');

  if (!checkoutStatus) return;

  // Clean URL without reloading
  var cleanUrl = window.location.pathname;
  window.history.replaceState({}, '', cleanUrl);

  if (checkoutStatus === 'success' && orderId) {
    // Clear cart and customer data after successful payment
    saveCart([]);
    localStorage.removeItem(CUST_KEY);
    updateBadge();

    // Show success message
    setTimeout(function() {
      showToast('Order ' + orderId + ' confirmed! Thank you!');
    }, 500);
  } else if (checkoutStatus === 'cancelled') {
    setTimeout(function() {
      showToast('Checkout cancelled — your cart is still saved.');
    }, 500);
  }
}

/* ===== INIT ===== */
async function init() {
  updateBadge();
  handleCheckoutResult();
  try {
    var albums = await loadAlbums();
    allPuzzles = albums.reduce(function(a, b) { return a.concat(b.puzzles); }, []);
    allPuzzles.forEach(function(p) { puzzleMap[p.puzzleId] = p; });
    if (!allPuzzles.length) {
      document.getElementById('featured-puzzle').innerHTML = '<div class="error-banner">No puzzles found.</div>';
      return;
    }
    renderFeatured(allPuzzles[0]);
    document.getElementById('collections').innerHTML = albums.map(function(a) { return renderAlbum(a, allPuzzles[0].puzzleId); }).join('');
    document.getElementById('collections').addEventListener('click', function(e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      e.preventDefault();
      var card = btn.closest('.puzzle-card');
      if (!card) return;
      var p = puzzleMap[card.dataset.id];
      if (!p) return;
      if (btn.dataset.action === 'cart') addToCart(p);
      else if (btn.dataset.action === 'play') openPlayer(p);
    });
  } catch (e) {
    console.error('Init:', e);
    document.getElementById('featured-puzzle').innerHTML = '<div class="error-banner">Failed to load puzzles.</div>';
  }
}
init();