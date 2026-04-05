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
var CART_KEY = 'cp_cart', CUST_KEY = 'cp_customer', THEME_KEY = 'cp_theme', ORDERS_KEY = 'cp_orders', ADDR_KEY = 'cp_addresses';
var API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3001/api'
  : 'https://api.stakcos.com/api';
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

/* ===== CUSTOMER (contact only — addresses live in ADDR_KEY) ===== */
function loadCust() { try { return JSON.parse(localStorage.getItem(CUST_KEY)) || {}; } catch (e) { return {}; } }
function saveCust(d) { localStorage.setItem(CUST_KEY, JSON.stringify(d)); }

/* ===== ADDRESS BOOK ===== */
// Addresses are stored as an array. Each has { id, label, address1, address2,
// city, postal, country, isDefault }. Exactly one address has isDefault=true
// at any given time (unless the book is empty).
//
// The address currently selected for THIS checkout is tracked in-memory
// (selectedAddrId). It defaults to whichever address has isDefault=true.
function loadAddrs() { try { return JSON.parse(localStorage.getItem(ADDR_KEY)) || []; } catch (e) { return []; } }
function saveAddrs(a) { localStorage.setItem(ADDR_KEY, JSON.stringify(a)); }

function genAddrId() {
  return 'addr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function getDefaultAddr() {
  var addrs = loadAddrs();
  return addrs.find(function(a) { return a.isDefault; }) || addrs[0] || null;
}

function getAddrById(id) {
  return loadAddrs().find(function(a) { return a.id === id; }) || null;
}

function setDefaultAddr(id) {
  var addrs = loadAddrs();
  addrs.forEach(function(a) { a.isDefault = (a.id === id); });
  saveAddrs(addrs);
}

function upsertAddr(addr) {
  var addrs = loadAddrs();
  if (addr.id) {
    var idx = addrs.findIndex(function(a) { return a.id === addr.id; });
    if (idx >= 0) {
      // Keep the existing isDefault flag; editing doesn't change default
      addr.isDefault = addrs[idx].isDefault;
      addrs[idx] = addr;
    } else {
      addrs.push(addr);
    }
  } else {
    addr.id = genAddrId();
    // First address automatically becomes default
    if (!addrs.length) addr.isDefault = true;
    addrs.push(addr);
  }
  saveAddrs(addrs);
  return addr;
}

function deleteAddr(id) {
  var addrs = loadAddrs();
  var target = addrs.find(function(a) { return a.id === id; });
  if (!target) return;
  var wasDefault = target.isDefault;
  addrs = addrs.filter(function(a) { return a.id !== id; });
  // If we removed the default, promote the first remaining to default
  if (wasDefault && addrs.length) addrs[0].isDefault = true;
  saveAddrs(addrs);
  // If the deleted address was currently selected, fall back to default
  if (selectedAddrId === id) selectedAddrId = null;
}

// ── One-time migration: old flat CUST_KEY had address fields mixed in ──
// If we detect old-shape data, split it: contact stays in CUST_KEY, address
// fields move into ADDR_KEY as the first (default) address.
function migrateCustToAddrBook() {
  var raw = localStorage.getItem(CUST_KEY);
  if (!raw) return;
  var c;
  try { c = JSON.parse(raw); } catch (e) { return; }
  if (!c || typeof c !== 'object') return;
  // Old shape detection: address fields exist AND address book is empty
  var hasAddrFields = !!(c.address1 || c.city || c.postal || c.country);
  if (!hasAddrFields) return;
  var existingAddrs = loadAddrs();
  if (existingAddrs.length) {
    // Address book already populated — just strip address fields from cust
    saveCust({ email: c.email || '', name: c.name || '', phone: c.phone || '' });
    return;
  }
  // Move address fields into the book
  upsertAddr({
    label: 'Home',
    address1: c.address1 || '',
    address2: c.address2 || '',
    city: c.city || '',
    postal: c.postal || '',
    country: c.country || ''
  });
  saveCust({ email: c.email || '', name: c.name || '', phone: c.phone || '' });
}

// ── Forget everything (privacy action) ──
function forgetEverything() {
  if (!confirm('This will clear all saved details from this browser:\n\n\u2022 Your contact info (email, name, phone)\n\u2022 All saved shipping addresses\n\u2022 Local order history\n\nYour cart will remain. Continue?')) return;
  localStorage.removeItem(CUST_KEY);
  localStorage.removeItem(ADDR_KEY);
  localStorage.removeItem(ORDERS_KEY);
  selectedAddrId = null;
  editingAddrId = null;
  isAddingAddr = false;
  showToast('All saved details cleared');
  renderCart();
}

// ── In-memory state for the address book UI ──
// selectedAddrId: which address is picked for THIS order (defaults to default)
// editingAddrId:  which address is currently being edited inline
// isAddingAddr:   true when the "+ Add new address" form is open
var selectedAddrId = null;
var editingAddrId = null;
var isAddingAddr = false;

function getSelectedAddr() {
  if (selectedAddrId) {
    var byId = getAddrById(selectedAddrId);
    if (byId) return byId;
  }
  return getDefaultAddr();
}

/* ===== VIEWS ===== */
var allPuzzles = [], puzzleMap = {};
function showView(nm) {
  document.querySelectorAll('.page-view').forEach(function(v) { v.classList.remove('active'); });
  var el = document.getElementById('view-' + nm);
  if (el) el.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (nm === 'cart') renderCart();
  if (nm === 'orders') renderOrders();
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
  // Run migration once on every cart render (idempotent after first pass)
  migrateCustToAddrBook();

  var items = loadCart(), el = document.getElementById('cart-content');
  if (!items.length) {
    el.innerHTML = '<div class="cart-empty"><p>Your cart is empty</p><button class="btn btn-buy" onclick="showView(\'shop\')">Browse Puzzles</button></div>';
    return;
  }
  var sub = cartSubtotal(), ship = sub >= FREE_SHIP ? 0 : SHIPPING;
  var tax = +(sub * TAX).toFixed(2), total = +(sub + ship + tax).toFixed(2);
  var c = loadCust();
  var cOk = !!(c.email && c.name && c.phone);
  var addrs = loadAddrs();
  var selAddr = getSelectedAddr();
  var sOk = !!(selAddr && selAddr.address1 && selAddr.city && selAddr.postal && selAddr.country);

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

  // ── Contact card (unchanged structure, contact only) ──
  var contactHtml = '<div class="sidebar-card">' +
    '<div class="collapsible-header" onclick="toggleSection(\'contact\')">' +
      '<h3><i class="fa-regular fa-user"></i> Contact Details</h3>' +
      '<span class="toggle-icon' + (cOk ? ' collapsed' : '') + '" id="contact-toggle"><i class="fa-solid fa-chevron-down"></i></span>' +
    '</div>' +
    '<div class="collapsible-summary' + (cOk ? ' visible' : '') + '" id="contact-summary">' +
      '<i class="fa-solid fa-circle-check"></i> ' +
      esc(c.name || '\u2014') + ' \u00b7 ' + esc(c.email || '\u2014') + ' \u00b7 ' + esc(c.phone || '\u2014') +
    '</div>' +
    '<div class="collapsible-body' + (cOk ? ' collapsed' : '') + '" id="contact-body">' +
      '<div class="form-field"><label>Email *</label><input type="email" id="c-email" placeholder="you@example.com" value="' + esc(c.email || '') + '" autocomplete="email"></div>' +
      '<div class="form-field"><label>Full Name *</label><input type="text" id="c-name" placeholder="Your full name" value="' + esc(c.name || '') + '" autocomplete="name"></div>' +
      '<div class="form-field"><label>Phone *</label><input type="tel" id="c-phone" placeholder="+65 9123 4567" value="' + esc(c.phone || '') + '" autocomplete="tel"></div>' +
    '</div>' +
  '</div>';

  // ── Shipping card — now delegates to the address book renderer ──
  var shipHtml = '<div class="sidebar-card">' +
    '<div class="collapsible-header" onclick="toggleSection(\'shipping\')">' +
      '<h3><i class="fa-solid fa-truck-fast"></i> Shipping Address</h3>' +
      '<span class="toggle-icon' + (sOk && !isAddingAddr && !editingAddrId ? ' collapsed' : '') + '" id="shipping-toggle"><i class="fa-solid fa-chevron-down"></i></span>' +
    '</div>' +
    '<div class="collapsible-summary' + (sOk && !isAddingAddr && !editingAddrId ? ' visible' : '') + '" id="shipping-summary">' +
      buildShippingSummaryHtml() +
    '</div>' +
    '<div class="collapsible-body' + (sOk && !isAddingAddr && !editingAddrId ? ' collapsed' : '') + '" id="shipping-body">' +
      renderAddressBook() +
    '</div>' +
  '</div>';

  var sumHtml = '<div class="sidebar-card"><h3>Order Summary</h3>' +
    '<div class="summary-row"><span>Subtotal (' + items.reduce(function(s, i) { return s + i.qty; }, 0) + ' items)</span><span>S$' + sub.toFixed(2) + '</span></div>' +
    '<div class="summary-row"><span>Shipping</span><span>' + (ship === 0 ? '<span style="color:var(--green)">Free</span>' : 'S$' + ship.toFixed(2)) + '</span></div>' +
    (sub < FREE_SHIP ? '<div style="font-size:10px;color:var(--text-muted);text-align:right;margin-top:-4px">Free over S$' + FREE_SHIP + '</div>' : '') +
    '<div class="summary-row"><span>GST (' + (TAX * 100) + '%)</span><span>S$' + tax.toFixed(2) + '</span></div>' +
    '<div class="summary-row total"><span>Total</span><span class="summary-val">S$' + total.toFixed(2) + '</span></div>' +
    '<button class="checkout-btn" id="checkout-btn" onclick="handleCheckout()">Checkout \u2014 S$' + total.toFixed(2) + '</button>' +
    '<div class="checkout-note">Secure checkout powered by Stripe.</div>' +
    '<button class="clear-cart-link" onclick="if(confirm(\'Clear all items?\'))clearCartAll()">Clear cart</button>' +
  '</div>';

  // ── Privacy: forget everything ──
  var forgetHtml = '<div class="forget-details-row">' +
    '<button class="forget-details-link" onclick="forgetEverything()">' +
      '<i class="fa-regular fa-trash-can"></i> Forget my details on this browser' +
    '</button>' +
  '</div>';

  el.innerHTML = '<div class="cart-layout">' +
    '<div class="cart-items">' + cartHtml + '</div>' +
    '<div class="cart-sidebar">' + contactHtml + shipHtml + sumHtml + forgetHtml + '</div>' +
  '</div>';

  document.querySelectorAll('[id^="c-"]').forEach(function(inp) {
    inp.addEventListener('blur', saveCustFields);
    inp.addEventListener('change', saveCustFields);
  });
}

/* ===== ADDRESS BOOK RENDERING ===== */
// Builds the contents of the shipping card body. Three possible states:
//   1. Empty book (first-time user) → show an inline form
//   2. Adding a new address → show the form at the bottom of the list
//   3. Editing an address → the list shows with the edited row replaced by the form
//   4. Normal → a list of saved addresses with radio selection + actions
function renderAddressBook() {
  var addrs = loadAddrs();

  // First-time flow: no saved addresses → show empty form immediately
  if (!addrs.length && !isAddingAddr) {
    return renderAddressForm(null, { firstTime: true });
  }

  // Build the list of saved addresses
  var selected = getSelectedAddr();
  var selectedId = selected ? selected.id : null;

  var rows = addrs.map(function(a) {
    if (editingAddrId === a.id) {
      // Replace this row with the edit form
      return renderAddressForm(a, { editing: true });
    }
    var isSelected = (a.id === selectedId);
    var isDefault = !!a.isDefault;
    var canDelete = addrs.length > 1;

    var addrLines = esc(a.address1 || '') +
      (a.address2 ? ', ' + esc(a.address2) : '') +
      '<br>' +
      (a.city ? esc(a.city) : '') +
      (a.postal ? ' ' + esc(a.postal) : '') +
      (COUNTRIES[a.country] ? ' \u00b7 ' + COUNTRIES[a.country] : '');

    return '<div class="addr-row' + (isSelected ? ' selected' : '') + '" onclick="selectAddr(\'' + a.id + '\')">' +
      '<div class="addr-row-radio">' +
        '<div class="addr-radio-dot' + (isSelected ? ' active' : '') + '"></div>' +
      '</div>' +
      '<div class="addr-row-body">' +
        '<div class="addr-row-header">' +
          '<span class="addr-label">' + esc(a.label || 'Address') + '</span>' +
          (isDefault ? '<span class="addr-default-tag">Default</span>' : '') +
        '</div>' +
        '<div class="addr-row-lines">' + addrLines + '</div>' +
        '<div class="addr-row-actions">' +
          '<button class="addr-action-link" onclick="event.stopPropagation();editAddr(\'' + a.id + '\')">Edit</button>' +
          (!isDefault ? '<button class="addr-action-link" onclick="event.stopPropagation();makeDefaultAddr(\'' + a.id + '\')">Make default</button>' : '') +
          (canDelete ? '<button class="addr-action-link danger" onclick="event.stopPropagation();deleteAddrConfirm(\'' + a.id + '\')">Delete</button>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  // Add-new form appears at the end of the list when isAddingAddr is true
  var addForm = '';
  if (isAddingAddr) {
    addForm = renderAddressForm(null, { adding: true });
  }

  // "+ Add new address" button (hidden while adding)
  var addButton = isAddingAddr ? '' :
    '<button class="addr-add-btn" onclick="startAddAddr()"><i class="fa-solid fa-plus"></i> Add new address</button>';

  return '<div class="addr-book">' + rows + addForm + addButton + '</div>';
}

// Renders the inline add/edit form. `mode.firstTime` hides the cancel button
// (since there's nothing to cancel back to). `mode.editing` passes the addr to edit.
// `mode.adding` means new address; no prefill.
function renderAddressForm(addr, mode) {
  mode = mode || {};
  addr = addr || {};
  var formId = mode.editing ? 'addr-form-' + addr.id : 'addr-form-new';
  var co = Object.keys(COUNTRIES).map(function(k) {
    return '<option value="' + k + '"' + (addr.country === k ? ' selected' : '') + '>' + COUNTRIES[k] + '</option>';
  }).join('');

  var cancelBtn = mode.firstTime ? '' :
    '<button class="btn btn-play btn-sm" onclick="cancelEditAddr()">Cancel</button>';
  var saveAction = mode.editing ?
    'saveEditAddr(\'' + addr.id + '\')' :
    'saveNewAddr()';

  return '<div class="addr-form" id="' + formId + '">' +
    (mode.editing || mode.adding ?
      '<div class="addr-form-header">' + (mode.editing ? 'Edit address' : 'New address') + '</div>' : '') +
    '<div class="form-field"><label>Label <span class="field-hint">(e.g. Home, Office)</span></label><input type="text" id="af-label" placeholder="Home" value="' + esc(addr.label || '') + '"></div>' +
    '<div class="form-field"><label>Address Line 1 *</label><input type="text" id="af-addr1" placeholder="Block, street, unit" value="' + esc(addr.address1 || '') + '" autocomplete="address-line1"></div>' +
    '<div class="form-field"><label>Address Line 2</label><input type="text" id="af-addr2" placeholder="Apartment, floor (optional)" value="' + esc(addr.address2 || '') + '" autocomplete="address-line2"></div>' +
    '<div class="form-row">' +
      '<div class="form-field"><label>City *</label><input type="text" id="af-city" placeholder="Singapore" value="' + esc(addr.city || '') + '" autocomplete="address-level2"></div>' +
      '<div class="form-field"><label>Postal Code *</label><input type="text" id="af-postal" placeholder="123456" value="' + esc(addr.postal || '') + '" autocomplete="postal-code"></div>' +
    '</div>' +
    '<div class="form-field"><label>Country *</label><select id="af-country" autocomplete="country"><option value="">Select country</option>' + co + '</select></div>' +
    '<div class="addr-form-actions">' +
      '<button class="btn btn-buy btn-sm" onclick="' + saveAction + '">' + (mode.editing ? 'Save changes' : 'Save address') + '</button>' +
      cancelBtn +
    '</div>' +
  '</div>';
}

// Builds the collapsed shipping summary line (used when card is collapsed)
function buildShippingSummaryHtml() {
  var a = getSelectedAddr();
  if (!a) return '<i class="fa-solid fa-circle-check"></i> No address selected';
  var line = '<i class="fa-solid fa-circle-check"></i> ';
  if (a.label) line += '<strong>' + esc(a.label) + '</strong> \u00b7 ';
  line += esc(a.address1 || '');
  if (a.city) line += ', ' + esc(a.city);
  if (a.postal) line += ' ' + esc(a.postal);
  if (COUNTRIES[a.country]) line += ' \u00b7 ' + COUNTRIES[a.country];
  return line;
}

/* ===== ADDRESS BOOK ACTIONS ===== */
function selectAddr(id) {
  if (editingAddrId || isAddingAddr) return; // ignore clicks while form is open
  selectedAddrId = id;
  renderCart();
}

function editAddr(id) {
  editingAddrId = id;
  isAddingAddr = false;
  renderCart();
}

function cancelEditAddr() {
  editingAddrId = null;
  isAddingAddr = false;
  renderCart();
}

function startAddAddr() {
  isAddingAddr = true;
  editingAddrId = null;
  renderCart();
}

function readAddrForm() {
  function g(id) { return (document.getElementById(id) || {}).value || ''; }
  return {
    label: g('af-label').trim(),
    address1: g('af-addr1').trim(),
    address2: g('af-addr2').trim(),
    city: g('af-city').trim(),
    postal: g('af-postal').trim(),
    country: g('af-country')
  };
}

function validateAddrForm(data) {
  var missing = [];
  if (!data.address1) missing.push('address');
  if (!data.city) missing.push('city');
  if (!data.postal) missing.push('postal code');
  if (!data.country) missing.push('country');
  return missing;
}

function saveNewAddr() {
  var data = readAddrForm();
  var missing = validateAddrForm(data);
  if (missing.length) {
    showToast('Please fill: ' + missing.join(', '));
    return;
  }
  if (!data.label) data.label = 'Address';
  var saved = upsertAddr(data);
  selectedAddrId = saved.id;
  isAddingAddr = false;
  renderCart();
  showToast('Address saved');
}

function saveEditAddr(id) {
  var data = readAddrForm();
  var missing = validateAddrForm(data);
  if (missing.length) {
    showToast('Please fill: ' + missing.join(', '));
    return;
  }
  if (!data.label) data.label = 'Address';
  data.id = id;
  upsertAddr(data);
  editingAddrId = null;
  renderCart();
  showToast('Address updated');
}

function deleteAddrConfirm(id) {
  var a = getAddrById(id);
  if (!a) return;
  var name = a.label || 'this address';
  if (!confirm('Delete "' + name + '"?')) return;
  deleteAddr(id);
  renderCart();
  showToast('Address deleted');
}

function makeDefaultAddr(id) {
  setDefaultAddr(id);
  renderCart();
  showToast('Default address updated');
}

/* ===== CUSTOMER SAVE / COLLAPSIBLE ===== */
function saveCustFields() {
  function g(id) { return (document.getElementById(id) || {}).value || ''; }
  // Contact only — addresses are managed by the address book
  saveCust({
    email: g('c-email').trim(),
    name: g('c-name').trim(),
    phone: g('c-phone').trim()
  });
  var c = loadCust();
  if (c.email && c.name && c.phone) collapseSection('contact');
}

// Build the summary HTML for the contact section (shipping has its own builder
// in buildShippingSummaryHtml because it needs address book awareness)
function buildSummaryHtml(sec) {
  if (sec === 'contact') {
    var c = loadCust();
    return '<i class="fa-solid fa-circle-check"></i> ' +
      esc(c.name || '\u2014') + ' \u00b7 ' +
      esc(c.email || '\u2014') + ' \u00b7 ' +
      esc(c.phone || '\u2014');
  }
  if (sec === 'shipping') {
    return buildShippingSummaryHtml();
  }
  return '';
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
    if (sum) {
      sum.innerHTML = buildSummaryHtml(sec);
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
  if (sum) {
    // Rebuild the summary content from current data — otherwise it
    // would show whatever was rendered when the cart page first loaded
    // (which is empty placeholders, producing "· ·").
    sum.innerHTML = buildSummaryHtml(sec);
    sum.classList.add('visible');
  }
}

function validateCust() {
  var c = loadCust(), m = [];
  if (!c.email || c.email.indexOf('@') < 0) m.push('email');
  if (!c.name) m.push('full name');
  if (!c.phone) m.push('phone');
  var a = getSelectedAddr();
  if (!a) { m.push('address'); return m; }
  if (!a.address1) m.push('address');
  if (!a.city) m.push('city');
  if (!a.postal) m.push('postal code');
  if (!a.country) m.push('country');
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
  var c = loadCust();
  var a = getSelectedAddr();
  var items = loadCart();
  var btn = document.getElementById('checkout-btn');
  btn.disabled = true; btn.textContent = 'Creating checkout...';
  try {
    var res = await fetch(STRIPE_EP, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: c.email, customerName: c.name, phone: c.phone,
        items: items.map(function(i) { return { puzzleId: i.puzzleId, name: i.name, layers: i.layers, price: i.price, qty: i.qty }; }),
        shippingAddress: {
          name: c.name,
          address1: a.address1,
          address2: a.address2 || '',
          city: a.city,
          postalCode: a.postal,
          country: a.country,
          phone: c.phone
        }
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
    // Save order reference to localStorage
    var c = loadCust();
    var shippedTo = getSelectedAddr() || {};
    var cartItems = loadCart();
    addLocalOrder({
      orderId: orderId,
      email: c.email || '',
      customerName: c.name || '',
      items: cartItems.map(function(i) { return { puzzleId: i.puzzleId, name: i.name, qty: i.qty }; }),
      amount: null, // We don't know the final Stripe amount here
      currency: 'SGD',
      status: 'paid',
      placedAt: new Date().toISOString(),
      shipping: {
        city: shippedTo.city || '',
        country: shippedTo.country || ''
      }
      // Note: card info not available here — Stripe handles payment, we only
      // know it succeeded. Card details appear when the user looks up the order.
    });

    // Clear cart only. Contact details and saved addresses persist so
    // the next purchase is a one-click affair. Users can wipe everything
    // with the "Forget my details" button if they want.
    saveCart([]);
    updateBadge();

    // Show success message and switch to orders view
    setTimeout(function() {
      showToast('Order ' + orderId + ' confirmed! Thank you!');
      showView('orders');
    }, 500);
  } else if (checkoutStatus === 'cancelled') {
    setTimeout(function() {
      showToast('Checkout cancelled — your cart is still saved.');
    }, 500);
  }
}

/* ===== LOCAL ORDERS (localStorage convenience layer) ===== */
function loadLocalOrders() { try { return JSON.parse(localStorage.getItem(ORDERS_KEY)) || []; } catch (e) { return []; } }
function saveLocalOrders(orders) { localStorage.setItem(ORDERS_KEY, JSON.stringify(orders)); }
function addLocalOrder(order) {
  var orders = loadLocalOrders();
  // Avoid duplicates
  var exists = orders.find(function(o) { return o.orderId === order.orderId; });
  if (!exists) {
    orders.unshift(order); // newest first
    if (orders.length > 50) orders = orders.slice(0, 50); // cap at 50
    saveLocalOrders(orders);
  }
}
function clearLocalOrders() {
  localStorage.removeItem(ORDERS_KEY);
  showToast('Saved order history cleared');
  renderOrders();
}

/* ===== ORDER LOOKUP (Stripe via backend) ===== */
async function lookupOrders(email, orderId) {
  var params = 'email=' + encodeURIComponent(email) + '&orderId=' + encodeURIComponent(orderId);
  var res = await fetch(API_BASE + '/orders?' + params);
  if (!res.ok) {
    var err = await res.json().catch(function() { return { error: 'Request failed' }; });
    throw new Error(err.error || 'HTTP ' + res.status);
  }
  return res.json();
}

/* ===== RENDER ORDERS VIEW ===== */
function renderOrders() {
  var el = document.getElementById('orders-content');
  if (!el) return;
  var localOrders = loadLocalOrders();
  var cust = loadCust();

  // Lookup form — both fields REQUIRED
  var formHtml = '<div class="orders-lookup">' +
    '<div class="sidebar-card">' +
      '<h3><i class="fa-solid fa-magnifying-glass"></i> Look Up an Order</h3>' +
      '<p class="orders-lookup-desc">Enter your email and order ID to retrieve a specific order. Both fields are required to protect your privacy.</p>' +
      '<div class="form-field"><label>Email *</label><input type="email" id="ol-email" placeholder="you@example.com" value="' + esc(cust.email || '') + '" autocomplete="email"></div>' +
      '<div class="form-field"><label>Order ID *</label><input type="text" id="ol-orderid" placeholder="CP-20260403-A7X"></div>' +
      '<button class="btn btn-buy" id="ol-btn" style="width:100%" onclick="handleOrderLookup()">Find Order</button>' +
      '<div id="ol-error" class="orders-error"></div>' +
    '</div>' +
    '<div class="orders-info-note">' +
      '<i class="fa-solid fa-envelope-open-text"></i>' +
      '<div><strong>Coming soon:</strong> full order history by email. We\u2019re building a secure email-based lookup so you can access all your orders from any device. For now, please keep your order confirmation emails handy.</div>' +
    '</div>' +
  '</div>';

  // Local orders section with explanatory notice
  var localHtml = '';
  if (localOrders.length) {
    var rows = localOrders.map(function(o) {
      return renderOrderCard(o);
    }).join('');
    localHtml = '<div class="orders-local">' +
      '<div class="orders-section-header">' +
        '<h3><i class="fa-solid fa-clock-rotate-left"></i> Your Recent Orders <span class="orders-source-tag">this browser</span></h3>' +
        '<button class="clear-cart-link" onclick="if(confirm(\'Clear saved order history from this browser?\'))clearLocalOrders()">Clear history</button>' +
      '</div>' +
      '<div class="orders-notice">' +
        '<i class="fa-solid fa-circle-info"></i>' +
        '<span>These orders are remembered only on this device. If you clear your browser data or switch computers, you\u2019ll need your order ID and email to look them up again.</span>' +
      '</div>' +
      rows +
    '</div>';
  } else {
    // Empty state — explain how it works
    localHtml = '<div class="orders-empty-state">' +
      '<i class="fa-regular fa-folder-open"></i>' +
      '<h3>No orders on this device yet</h3>' +
      '<p>After you complete a purchase, your order will appear here for quick access \u2014 but only on this browser. To look up an order from another device, use the form on the left with your email and order ID (from your confirmation email).</p>' +
    '</div>';
  }

  // Results container (populated by lookup)
  var resultsHtml = '<div id="ol-results"></div>';

  el.innerHTML = '<div class="orders-layout">' + formHtml + '<div class="orders-main">' + localHtml + resultsHtml + '</div></div>';
}

function renderOrderCard(o) {
  var statusClass = o.status === 'paid' ? 'status-paid' : 'status-pending';
  var statusLabel = o.status === 'paid' ? 'Paid' : (o.status || 'Unknown');

  // Support both the new `placedAt` field (from updated API) and legacy `paidAt`
  // (from previously cached localStorage orders). Either way, show date + time.
  var ts = o.placedAt || o.paidAt;
  var dateStr = '', timeStr = '';
  if (ts) {
    var d = new Date(ts);
    dateStr = d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
    timeStr = d.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' });
  }

  var itemsStr = '';
  if (o.items && o.items.length) {
    itemsStr = o.items.map(function(i) {
      var name = i.name || i.puzzleId || 'Puzzle';
      return name + (i.qty > 1 ? ' \u00d7' + i.qty : '');
    }).join(', ');
  }

  // Build ship-to string — city + country only, regardless of source
  var shipStr = '';
  if (o.shipping && (o.shipping.city || o.shipping.country)) {
    shipStr = [o.shipping.city, o.shipping.country].filter(Boolean).join(', ');
  }

  // Payment method — brand icon + last 4
  var cardHtml = '';
  if (o.card && o.card.last4) {
    var brand = (o.card.brand || '').toLowerCase();
    var brandIcon = 'fa-credit-card'; // generic fallback
    var brandMap = {
      visa: 'fa-cc-visa',
      mastercard: 'fa-cc-mastercard',
      amex: 'fa-cc-amex',
      discover: 'fa-cc-discover',
      diners: 'fa-cc-diners-club',
      jcb: 'fa-cc-jcb'
    };
    if (brandMap[brand]) brandIcon = brandMap[brand];
    cardHtml = '<div class="order-detail"><span class="order-detail-label">Paid with</span>' +
      '<span class="order-detail-value order-card-info">' +
        '<i class="fa-brands ' + brandIcon + '"></i>' +
        '<span class="order-card-dots">\u2022\u2022\u2022\u2022 ' + esc(o.card.last4) + '</span>' +
      '</span></div>';
  }

  return '<div class="order-card">' +
    '<div class="order-card-header">' +
      '<div class="order-id-row">' +
        '<span class="order-id-label">' + esc(o.orderId || 'N/A') + '</span>' +
        '<span class="order-status ' + statusClass + '">' + esc(statusLabel) + '</span>' +
      '</div>' +
      (dateStr ? '<div class="order-date"><i class="fa-regular fa-clock"></i> ' + dateStr + ' \u00b7 ' + timeStr + '</div>' : '') +
    '</div>' +
    '<div class="order-card-body">' +
      (o.amount && o.amount !== '0.00' ? '<div class="order-detail"><span class="order-detail-label">Total</span><span class="order-detail-value order-amount">' + o.currency + ' ' + o.amount + '</span></div>' : '') +
      cardHtml +
      (o.email ? '<div class="order-detail"><span class="order-detail-label">Email</span><span class="order-detail-value">' + esc(o.email) + '</span></div>' : '') +
      (o.customerName ? '<div class="order-detail"><span class="order-detail-label">Name</span><span class="order-detail-value">' + esc(o.customerName) + '</span></div>' : '') +
      (itemsStr ? '<div class="order-detail"><span class="order-detail-label">Items</span><span class="order-detail-value">' + esc(itemsStr) + '</span></div>' : '') +
      (shipStr ? '<div class="order-detail"><span class="order-detail-label">Ship to</span><span class="order-detail-value">' + esc(shipStr) + '</span></div>' : '') +
    '</div>' +
  '</div>';
}

async function handleOrderLookup() {
  var email = (document.getElementById('ol-email').value || '').trim();
  var orderId = (document.getElementById('ol-orderid').value || '').trim();
  var errEl = document.getElementById('ol-error');
  var resEl = document.getElementById('ol-results');
  var btn = document.getElementById('ol-btn');

  errEl.textContent = '';

  // Tier 1: both fields required on the client too
  if (!email || email.indexOf('@') < 0) {
    errEl.textContent = 'Please enter a valid email address.';
    return;
  }
  if (!orderId) {
    errEl.textContent = 'Please enter your order ID (from the confirmation email).';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Searching...';
  resEl.innerHTML = '<div class="orders-loading"><div class="loader"></div></div>';

  try {
    var data = await lookupOrders(email, orderId);
    if (data.order) {
      resEl.innerHTML = '<div class="orders-section-header"><h3><i class="fa-solid fa-receipt"></i> Order Found</h3></div>' + renderOrderCard(data.order);
    } else {
      resEl.innerHTML = '<div class="orders-empty"><i class="fa-regular fa-face-meh"></i><p>No matching order found.</p></div>';
    }
  } catch (e) {
    errEl.textContent = e.message || 'Failed to look up order.';
    resEl.innerHTML = '';
  }

  btn.disabled = false;
  btn.textContent = 'Find Order';
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