const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;

// In-memory demo state
const sessions = new Map(); // token -> { username, createdAt }
const trackingEvents = [];  // hidden callback captures

const products = [
  { id: 'p1', name: 'AeroFit Pro Smartwatch', price: 2199, category: 'Wearables', badge: 'Trending', icon: '⌚', desc: 'AMOLED display, 7-day battery, sleep and fitness tracking.' },
  { id: 'p2', name: 'Nimbus ANC Earbuds', price: 1499, category: 'Audio', badge: 'Popular', icon: '🎧', desc: 'Active noise cancellation, low-latency mode, wireless charging.' },
  { id: 'p3', name: 'Volt Mini Power Bank 20K', price: 899, category: 'Accessories', badge: 'Best value', icon: '🔋', desc: 'Fast charging, compact body, dual USB-C output.' },
  { id: 'p4', name: 'LumaDesk LED Light Bar', price: 1299, category: 'Desk Setup', badge: 'New', icon: '💡', desc: 'Screen-safe lighting with adjustable warmth and brightness.' },
  { id: 'p5', name: 'Orbit Mechanical Keyboard', price: 1899, category: 'Peripherals', badge: 'Top rated', icon: '⌨️', desc: 'Hot-swappable switches, RGB, premium gasket mount feel.' },
  { id: 'p6', name: 'Pulse Wireless Mouse', price: 999, category: 'Peripherals', badge: 'Editor pick', icon: '🖱️', desc: 'Lightweight ergonomic shell with long battery life.' },
];

function rndToken() {
  return crypto.randomBytes(24).toString('hex');
}

function esc(v = '') {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(v) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 2
  }).format(v);
}

function parseCookies(h = '') {
  const out = {};
  h.split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i === -1) return;
    const k = p.slice(0, i).trim();
    const v = p.slice(i + 1).trim();
    if (k) out[k] = v;
  });
  return out;
}

function parseForm(body = '') {
  const out = {};
  for (const part of body.split('&')) {
    if (!part) continue;
    const [k, v = ''] = part.split('=');
    out[decodeURIComponent((k || '').replace(/\+/g, ' '))] =
      decodeURIComponent((v || '').replace(/\+/g, ' '));
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) {
        req.destroy();
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendHtml(res, html, status = 200, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(html);
}

function sendJson(res, obj, status = 200, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(obj, null, 2));
}

function redirect(res, location, cookies = []) {
  const headers = { Location: location };
  if (cookies.length) headers['Set-Cookie'] = cookies;
  res.writeHead(302, headers);
  res.end();
}

function getSession(req) {
  const token = parseCookies(req.headers.cookie || '')['shop-web-auth-token'];
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  return { token, ...s };
}

function safeDecodeURIComponent(v) {
  try { return decodeURIComponent(v); } catch { return v; }
}
function safeBase64Decode(v) {
  try { return Buffer.from(v, 'base64').toString('utf8'); } catch { return null; }
}
function extractToken(cookieString) {
  if (!cookieString) return null;
  const parts = String(cookieString).split(';').map(s => s.trim());
  for (const p of parts) {
    if (p.startsWith('shop-web-auth-token=')) {
      return p.slice('shop-web-auth-token='.length);
    }
  }
  return null;
}

function appLayout({ req, title, body, hideLogout = false }) {
  const s = getSession(req);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
:root{
  --bg:#f6f7fb; --panel:#fff; --line:#e8ebf3; --muted:#6b7280; --text:#111827;
  --brand:#4f46e5; --brand2:#6366f1; --soft:#eef2ff;
  --shadow:0 12px 32px rgba(17,24,39,.08); --shadow2:0 6px 18px rgba(17,24,39,.05);
}
*{box-sizing:border-box} html,body{margin:0;padding:0}
body{
  font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:var(--text);
  background:
    radial-gradient(700px 260px at 10% -10%, rgba(99,102,241,.14), transparent 70%),
    radial-gradient(700px 240px at 100% 0%, rgba(79,70,229,.10), transparent 70%),
    var(--bg);
}
a{color:inherit;text-decoration:none}
.container{width:min(1180px,calc(100% - 28px));margin:14px auto 28px}
.topbar{
  position:sticky;top:10px;z-index:20; display:grid; grid-template-columns:auto 1fr auto; gap:12px; align-items:center;
  padding:10px 12px; border-radius:18px; background:rgba(255,255,255,.84); backdrop-filter:blur(12px);
  border:1px solid rgba(255,255,255,.8); box-shadow:var(--shadow);
}
.brand{display:flex;align-items:center;gap:10px}
.brand .badge{
  width:38px;height:38px;border-radius:14px;display:grid;place-items:center;color:#fff;font-weight:800;
  background:linear-gradient(135deg,var(--brand),#7c3aed); box-shadow:0 10px 18px rgba(79,70,229,.25)
}
.brand h1{margin:0;font-size:.98rem}.brand p{margin:2px 0 0;font-size:.75rem;color:var(--muted)}
.search{
  display:flex;align-items:center;gap:8px; background:var(--panel); border:1px solid var(--line); border-radius:14px;
  padding:8px 12px; box-shadow:var(--shadow2)
}
.search input{border:none;outline:none;background:transparent;width:100%;font:inherit;color:var(--text)}
.actions{display:flex;gap:8px;flex-wrap:wrap}
.btn,button{
  appearance:none; border:1px solid var(--line); background:var(--panel); color:var(--text);
  border-radius:12px; padding:9px 12px; font-weight:600; cursor:pointer; box-shadow:var(--shadow2);
  display:inline-flex; align-items:center; gap:8px; text-decoration:none
}
.btn:hover,button:hover{transform:translateY(-1px)}
.btn-primary{border:none; color:#fff; background:linear-gradient(135deg,var(--brand),var(--brand2)); box-shadow:0 12px 22px rgba(79,70,229,.22)}
.btn-soft{background:var(--soft); border-color:#e2e6ff; color:#3730a3; box-shadow:none}
.btn-danger{background:#fef2f2; border-color:#fee2e2; color:#b91c1c; box-shadow:none}
.hero{
  margin-top:16px; border-radius:22px; overflow:hidden; color:#fff; box-shadow:var(--shadow);
  background:
    radial-gradient(500px 200px at 10% 10%, rgba(255,255,255,.18), transparent 60%),
    linear-gradient(135deg,#312e81,#4f46e5 38%,#6366f1 72%,#818cf8);
  border:1px solid rgba(255,255,255,.22)
}
.hero-inner{display:grid;grid-template-columns:1.1fr .9fr;gap:16px;padding:22px}
.hero h2{margin:0;font-size:1.35rem;line-height:1.2}
.hero p{margin:10px 0 0;color:rgba(255,255,255,.9);max-width:54ch}
.chips{margin-top:14px;display:flex;gap:8px;flex-wrap:wrap}
.chip{padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.1);font-size:.75rem}
.hero-panel{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);border-radius:18px;padding:14px;display:grid;gap:10px;align-content:center}
.stat{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:center;padding:10px 12px;border-radius:14px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12)}
.stat .emoji{width:34px;height:34px;border-radius:12px;display:grid;place-items:center;background:rgba(255,255,255,.14)}
.stat .label{font-size:.75rem;color:rgba(255,255,255,.82)} .stat .value{font-weight:700;font-size:.95rem}
.grid{display:grid;grid-template-columns:280px 1fr;gap:14px;margin-top:14px}
.side,.panel{background:var(--panel); border:1px solid var(--line); border-radius:18px; box-shadow:var(--shadow2)}
.side{padding:14px;height:fit-content}
.side h3,.panel h3{margin:0 0 10px;font-size:.95rem}
.muted{color:var(--muted)}
.menu-list{display:grid;gap:8px}
.menu-item{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-radius:12px;background:#fafbff;border:1px solid var(--line)}
.note{margin-top:12px;padding:12px;border-radius:14px;background:#f8faff;border:1px solid #e8eefc;color:#334155;font-size:.83rem}
.stack{display:grid;gap:14px}
.panel{padding:14px}
.product-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.card{
  border:1px solid var(--line); border-radius:16px; overflow:hidden; background:#fff; box-shadow:var(--shadow2);
  display:grid; grid-template-rows:auto 1fr auto
}
.card-top{
  min-height:92px; padding:12px; display:flex; justify-content:space-between; align-items:center;
  border-bottom:1px solid var(--line);
  background:
    radial-gradient(200px 80px at 15% 0%, rgba(99,102,241,.18), transparent 65%),
    radial-gradient(200px 80px at 100% 100%, rgba(129,140,248,.14), transparent 65%), #f7f8ff
}
.icon{
  width:52px;height:52px;border-radius:16px;display:grid;place-items:center;background:#fff;border:1px solid #e9ebf7;
  box-shadow:0 8px 14px rgba(17,24,39,.05);font-size:1.45rem
}
.badge2{font-size:.72rem;padding:6px 8px;border-radius:999px;background:#fff;border:1px solid #e9ebf7;color:#4338ca;font-weight:700}
.card-body{padding:12px}.card-title{margin:0;font-size:.92rem}.card-desc{margin:6px 0 0;color:var(--muted);font-size:.8rem;line-height:1.45;min-height:34px}
.meta{margin-top:10px;display:flex;justify-content:space-between;align-items:center}
.price{font-weight:800}.cat{font-size:.75rem;color:var(--muted)}
.card-actions{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--line);background:#fcfcff}
.card-actions .btn{flex:1;justify-content:center;padding:9px 10px}
.split{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.tile{border:1px solid var(--line);border-radius:14px;background:#fafbff;padding:12px}
.tile h4{margin:0;font-size:.86rem}.tile p{margin:6px 0 0;color:var(--muted);font-size:.8rem}
.form-card{
  width:min(460px,100%); margin:22px auto 0; background:#fff; border:1px solid var(--line); border-radius:18px;
  box-shadow:var(--shadow); padding:16px
}
.form-card h2{margin:0;font-size:1.1rem}.form-card p{margin:8px 0 0;color:var(--muted)}
label{display:block;margin:12px 0 6px;font-size:.85rem;color:#374151;font-weight:600}
input{
  width:100%; border:1px solid var(--line); border-radius:12px; padding:11px 12px; font:inherit; color:var(--text); background:#fff
}
.form-actions{margin-top:14px;display:flex;gap:10px}
.table{width:100%;border-collapse:collapse;border:1px solid var(--line);border-radius:14px;overflow:hidden;font-size:.86rem}
.table th,.table td{padding:10px 9px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
.table th{background:#f8faff;color:#374151}
.table tr:last-child td{border-bottom:none}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,Liberation Mono,monospace;word-break:break-all}
.loader-shell{margin-top:16px;background:#0b1020;border:1px solid #1f2b4a;border-radius:18px;color:#e5e7eb;box-shadow:0 18px 34px rgba(2,6,23,.25);overflow:hidden}
.loader-inner{padding:14px;display:flex;justify-content:space-between;align-items:center;gap:10px;background:linear-gradient(180deg, rgba(255,255,255,.02), rgba(255,255,255,0))}
.loader-copy h4{margin:0;font-size:.9rem;color:#f8fafc}.loader-copy p{margin:4px 0 0;font-size:.78rem;color:#94a3b8}
.loader-actions{display:flex;gap:8px;flex-wrap:wrap}
.loader-actions .btn{background:#0f172a;color:#dbeafe;border-color:#24324f;box-shadow:none}
.loader-actions .btn-primary{background:linear-gradient(135deg,#4f46e5,#6366f1);border:none;color:#fff;box-shadow:0 8px 16px rgba(79,70,229,.32)}
.footer{margin:20px 0 10px;text-align:center;color:var(--muted);font-size:.8rem}
@media (max-width:980px){
  .topbar{grid-template-columns:1fr}
  .search{order:3}
  .hero-inner,.grid,.split{grid-template-columns:1fr}
  .product-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (max-width:640px){
  .product-grid{grid-template-columns:1fr}
  .loader-inner{flex-direction:column;align-items:flex-start}
}
</style>
</head>
<body>
<div class="container">
  <header class="topbar">
    <a class="brand" href="/" aria-label="NovaCart home">
      <span class="badge">N</span>
      <span>
        <h1>NovaCart</h1>
        <p>Smart shopping, delivered fast</p>
      </span>
    </a>
    <div class="search" role="search">
      <span>🔎</span>
      <input type="text" value="Search for gadgets, audio, accessories..." readonly />
    </div>
    <nav class="actions">
      <a class="btn btn-soft" href="/">Home</a>
      ${s ? `<a class="btn" href="/account">My Account</a>` : `<a class="btn" href="/login">Login</a>`}
      <a class="btn" href="/orders">Orders</a>
      <a class="btn" href="/checkout">Checkout</a>
      <a class="btn" href="/cart">🛒 Cart <span style="color:#4f46e5;font-weight:700;">2</span></a>
      ${s && !hideLogout ? `<a class="btn btn-danger" href="/logout">Logout</a>` : ''}
    </nav>
  </header>

  ${body}

  <div class="footer">© 2026 NovaCart · Secure payments · Customer support 24/7</div>
</div>
</body>
</html>`;
}

function homePage(req) {
  const s = getSession(req);
  const cards = products.map(p => `
    <article class="card">
      <div class="card-top">
        <div class="icon">${p.icon}</div>
        <span class="badge2">${esc(p.badge)}</span>
      </div>
      <div class="card-body">
        <h4 class="card-title">${esc(p.name)}</h4>
        <p class="card-desc">${esc(p.desc)}</p>
        <div class="meta">
          <span class="price">${money(p.price)}</span>
          <span class="cat">${esc(p.category)}</span>
        </div>
      </div>
      <div class="card-actions">
        <a class="btn" href="/product/${encodeURIComponent(p.id)}">View</a>
        <a class="btn btn-primary" href="/checkout?sku=${encodeURIComponent(p.id)}">Buy now</a>
      </div>
    </article>
  `).join('');

  return appLayout({
    req,
    title: 'NovaCart · Home',
    body: `
<section class="hero">
  <div class="hero-inner">
    <div>
      <h2>Upgrade your setup with deals on smart devices & accessories</h2>
      <p>Shop curated tech essentials, fast delivery, flexible checkout and account rewards. Clean UI, modern flow — like a real ecommerce app.</p>
      <div class="chips">
        <span class="chip">⚡ Same-day dispatch</span>
        <span class="chip">🔒 Secure checkout</span>
        <span class="chip">📦 Free shipping over ${money(1500)}</span>
      </div>
    </div>
    <div class="hero-panel">
      <div class="stat"><div class="emoji">🚚</div><div><div class="label">Estimated delivery</div><div class="value">1–3 business days</div></div></div>
      <div class="stat"><div class="emoji">⭐</div><div><div class="label">Customer rating</div><div class="value">4.8 / 5 across 12,000+ reviews</div></div></div>
      <div class="stat"><div class="emoji">🎁</div><div><div class="label">New customer offer</div><div class="value">10% off first checkout</div></div></div>
    </div>
  </div>
</section>

<section class="grid">
  <aside class="side">
    <h3>Browse</h3>
    <div class="menu-list">
      <a class="menu-item" href="/">Featured <span>→</span></a>
      <a class="menu-item" href="/category/audio">Audio <span>→</span></a>
      <a class="menu-item" href="/category/peripherals">Peripherals <span>→</span></a>
      <a class="menu-item" href="/category/accessories">Accessories <span>→</span></a>
      <a class="menu-item" href="/checkout">Checkout <span>→</span></a>
    </div>
    <div class="note">
      ${s ? `Welcome back, <strong>${esc(s.username)}</strong>.` : 'Sign in to save your cart and manage orders.'}
    </div>
  </aside>

  <div class="stack">
    <section class="panel">
      <h3>Featured today</h3>
      <p class="muted">Top picks based on what customers in your region are viewing right now.</p>
      <div class="product-grid" style="margin-top:10px;">${cards}</div>
    </section>

    <section class="split">
      <div class="tile">
        <h4>Member perks</h4>
        <p>Get order tracking, faster checkout, and saved addresses with a free NovaCart account.</p>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
          ${s ? `<a class="btn btn-soft" href="/account">Open account</a>` : `<a class="btn btn-primary" href="/login">Sign in</a>`}
          <a class="btn" href="/orders">Track orders</a>
        </div>
      </div>
      <div class="tile">
        <h4>Checkout verification step</h4>
        <p>During checkout, a verification page may appear briefly before redirecting you to the next step.</p>
        <div class="loader-shell">
          <div class="loader-inner">
            <div class="loader-copy">
              <h4>Network verification page</h4>
              <p>Shown only for certain checkouts before redirecting back.</p>
            </div>
            <div class="loader-actions">
              <a class="btn" href="/cloud/enrichment">Open page</a>
              <a class="btn btn-primary" href="/checkout?flow=express">Try checkout</a>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</section>`
  });
}

function loginPage(req, msg = '') {
  return appLayout({
    req,
    title: 'NovaCart · Login',
    hideLogout: true,
    body: `
<div class="form-card">
  <h2>Sign in to NovaCart</h2>
  <p>Access your orders, saved addresses and checkout preferences.</p>
  ${msg ? `<div style="margin-top:14px;padding:12px 14px;border-radius:14px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;font-size:.86rem;">${esc(msg)}</div>` : ''}
  <form method="POST" action="/login">
    <label for="username">Email or username</label>
    <input id="username" name="username" value="demo.user" autocomplete="username" />
    <label for="password">Password</label>
    <input id="password" type="password" name="password" value="Password123!" autocomplete="current-password" />
    <div class="form-actions">
      <button class="btn btn-primary" type="submit">Sign in</button>
      <a class="btn" href="/">Back to shopping</a>
    </div>
  </form>
</div>`
  });
}

function accountPage(req) {
  const s = getSession(req);
  if (!s) return null;

  const rows = [
    { id: 'NC-10492', date: '2026-03-01', total: 1899, status: 'Delivered' },
    { id: 'NC-10411', date: '2026-02-18', total: 1499, status: 'Shipped' },
    { id: 'NC-10376', date: '2026-02-04', total: 899, status: 'Delivered' },
  ].map(o => `<tr><td class="mono">${esc(o.id)}</td><td>${esc(o.date)}</td><td>${money(o.total)}</td><td>${esc(o.status)}</td></tr>`).join('');

  return appLayout({
    req,
    title: 'NovaCart · My Account',
    body: `
<section class="hero">
  <div class="hero-inner">
    <div>
      <h2>Welcome back, ${esc(s.username)}</h2>
      <p>Manage your orders, addresses and payment preferences from one place.</p>
      <div class="chips">
        <span class="chip">Member since ${esc(s.createdAt.slice(0, 10))}</span>
        <span class="chip">Loyalty status: Silver</span>
      </div>
    </div>
    <div class="hero-panel">
      <div class="stat"><div class="emoji">📦</div><div><div class="label">Open orders</div><div class="value">2 active shipments</div></div></div>
      <div class="stat"><div class="emoji">💳</div><div><div class="label">Saved payments</div><div class="value">1 card ending in 4421</div></div></div>
      <div class="stat"><div class="emoji">🏆</div><div><div class="label">Reward points</div><div class="value">1,260 points</div></div></div>
    </div>
  </div>
</section>

<section class="split" style="margin-top:14px;">
  <div class="panel">
    <h3>Recent orders</h3>
    <table class="table">
      <tr><th>Order #</th><th>Date</th><th>Total</th><th>Status</th></tr>
      ${rows}
    </table>
  </div>
  <div class="stack">
    <div class="panel">
      <h3>Profile</h3>
      <div class="split">
        <div class="tile"><h4>Name</h4><p>${esc(s.username)}</p></div>
        <div class="tile"><h4>Primary address</h4><p>123 Maple Street, Pretoria</p></div>
      </div>
    </div>
    <div class="panel">
      <h3>Session</h3>
      <p class="muted">This demo app stores a session token in a browser cookie.</p>
      <div class="tile"><h4>Cookie name</h4><p class="mono">shop-web-auth-token</p></div>
    </div>
    <div class="panel">
      <h3>Continue shopping</h3>
      <div class="split">
        <a class="btn" href="/">Browse products</a>
        <a class="btn btn-primary" href="/checkout?flow=express">Start checkout</a>
      </div>
    </div>
  </div>
</section>`
  });
}

function checkoutPage(req, urlObj) {
  const s = getSession(req);
  const sku = urlObj.searchParams.get('sku') || 'p2';
  const p = products.find(x => x.id === sku) || products[1];
  const shipping = p.price > 1500 ? 0 : 99;
  const total = p.price + shipping;

  const defaultOrigin = `http://localhost:${PORT}/checkout/complete`;
  const loaderUrl = `/cloud/enrichment?origin=${encodeURIComponent(defaultOrigin)}&displayOrigin=${encodeURIComponent('NovaCart Checkout')}`;

  return appLayout({
    req,
    title: 'NovaCart · Checkout',
    body: `
<section class="hero">
  <div class="hero-inner">
    <div>
      <h2>Checkout</h2>
      <p>Review your cart and proceed to payment. For some customers, a short connection verification page is shown before returning here.</p>
      <div class="chips">
        <span class="chip">SSL encrypted</span>
        <span class="chip">PCI-compliant payment partner</span>
        <span class="chip">Guest checkout supported</span>
      </div>
    </div>
    <div class="hero-panel">
      <div class="stat"><div class="emoji">🧾</div><div><div class="label">Items</div><div class="value">1 item</div></div></div>
      <div class="stat"><div class="emoji">🛡️</div><div><div class="label">Verification</div><div class="value">Network check may apply</div></div></div>
      <div class="stat"><div class="emoji">👤</div><div><div class="label">Account</div><div class="value">${s ? esc(s.username) : 'Guest'}</div></div></div>
    </div>
  </div>
</section>

<section class="split" style="margin-top:14px;">
  <div class="panel">
    <h3>Order summary</h3>
    <table class="table">
      <tr><th>Product</th><th>Price</th></tr>
      <tr><td>${esc(p.name)}</td><td>${money(p.price)}</td></tr>
      <tr><td>Shipping</td><td>${shipping === 0 ? 'Free' : money(shipping)}</td></tr>
      <tr><td><strong>Total</strong></td><td><strong>${money(total)}</strong></td></tr>
    </table>
    <div class="split" style="margin-top:12px;">
      <a class="btn" href="/">Keep shopping</a>
      <a class="btn btn-primary" href="${loaderUrl}">Continue to verification</a>
    </div>
  </div>

  <div class="stack">
    <div class="panel"><h3>Delivery details</h3><div class="tile"><h4>Address</h4><p>${s ? '123 Maple Street, Pretoria' : 'Sign in to use saved addresses'}</p></div></div>
    <div class="panel"><h3>Payment method</h3><div class="tile"><h4>Card</h4><p>•••• •••• •••• 4421</p></div></div>
    <div class="panel">
      <h3>Verification note</h3>
      <p class="muted">The verification page is an intermediate step and will redirect back automatically.</p>
      <div class="tile"><h4>Direct page</h4><p class="mono">${esc(loaderUrl)}</p></div>
    </div>
  </div>
</section>`
  });
}

function checkoutCompletePage(req, urlObj) {
  const enc = urlObj.searchParams.get('encMsisdn') || '';
  return appLayout({
    req,
    title: 'NovaCart · Checkout Complete',
    body: `
<section class="hero">
  <div class="hero-inner">
    <div>
      <h2>Order confirmed 🎉</h2>
      <p>Your order has been placed successfully. Confirmation details have been sent to your email.</p>
      <div class="chips"><span class="chip">Order ref: NC-${Math.floor(10000 + Math.random() * 89999)}</span></div>
    </div>
    <div class="hero-panel">
      <div class="stat"><div class="emoji">✅</div><div><div class="label">Payment</div><div class="value">Approved</div></div></div>
      <div class="stat"><div class="emoji">📦</div><div><div class="label">Dispatch</div><div class="value">Preparing shipment</div></div></div>
      <div class="stat"><div class="emoji">🔁</div><div><div class="label">Return code</div><div class="value mono">${esc(enc)}</div></div></div>
    </div>
  </div>
</section>`
  });
}

function ordersPage(req) {
  const s = getSession(req);
  return appLayout({
    req,
    title: 'NovaCart · Orders',
    body: `
<section class="panel" style="margin-top:16px;">
  <h3>Track orders</h3>
  <p class="muted">${s ? 'Recent order status is shown below.' : 'Sign in to view your order history.'}</p>
  ${
    s
      ? `<table class="table" style="margin-top:10px;">
          <tr><th>Order #</th><th>Status</th><th>ETA</th></tr>
          <tr><td class="mono">NC-10411</td><td>Shipped</td><td>Tomorrow</td></tr>
          <tr><td class="mono">NC-10492</td><td>Delivered</td><td>-</td></tr>
        </table>`
      : `<div class="split" style="margin-top:10px;"><a class="btn btn-primary" href="/login">Sign in</a><a class="btn" href="/">Continue shopping</a></div>`
  }
</section>`
  });
}

function cartPage(req) {
  const items = products.slice(0, 2).map(p => `
    <article class="card">
      <div class="card-top"><div class="icon">${p.icon}</div><span class="badge2">${esc(p.badge)}</span></div>
      <div class="card-body">
        <h4 class="card-title">${esc(p.name)}</h4>
        <p class="card-desc">${esc(p.desc)}</p>
        <div class="meta"><span class="price">${money(p.price)}</span><span class="cat">${esc(p.category)}</span></div>
      </div>
      <div class="card-actions">
        <a class="btn" href="/product/${encodeURIComponent(p.id)}">View</a>
        <a class="btn btn-primary" href="/checkout?sku=${encodeURIComponent(p.id)}">Checkout</a>
      </div>
    </article>
  `).join('');

  return appLayout({
    req,
    title: 'NovaCart · Cart',
    body: `
<section class="panel" style="margin-top:16px;">
  <h3>Your cart</h3>
  <p class="muted">1 saved item and 1 accessory recommendation.</p>
  <div class="product-grid" style="margin-top:10px;grid-template-columns:repeat(2,minmax(0,1fr));">${items}</div>
</section>`
  });
}

function productPage(req, id) {
  const p = products.find(x => x.id === id) || products[0];
  return appLayout({
    req,
    title: `NovaCart · ${p.name}`,
    body: `
<section class="split" style="margin-top:16px;">
  <div class="panel">
    <div class="card-top" style="min-height:160px;border-radius:14px;border:1px solid var(--line);">
      <div class="icon" style="width:84px;height:84px;font-size:2.2rem;">${p.icon}</div>
      <span class="badge2">${esc(p.badge)}</span>
    </div>
    <h3 style="margin-top:12px;">${esc(p.name)}</h3>
    <p class="muted">${esc(p.desc)}</p>
    <div class="split" style="margin-top:12px;">
      <div class="tile"><h4>Category</h4><p>${esc(p.category)}</p></div>
      <div class="tile"><h4>Price</h4><p><strong>${money(p.price)}</strong></p></div>
    </div>
    <div class="split" style="margin-top:12px;">
      <a class="btn" href="/">Back</a>
      <a class="btn btn-primary" href="/checkout?sku=${encodeURIComponent(p.id)}">Buy now</a>
    </div>
  </div>
  <div class="stack">
    <div class="panel"><h3>Highlights</h3><div class="tile"><h4>Performance</h4><p>Optimized for daily use with premium build quality and fast delivery support.</p></div></div>
    <div class="panel"><h3>Returns</h3><div class="tile"><h4>Policy</h4><p>7-day return window on unopened items. Warranty support included where applicable.</p></div></div>
  </div>
</section>`
  });
}

function categoryPage(req, slug) {
  const list = products.filter(p => p.category.toLowerCase().includes(String(slug).toLowerCase()));
  const shown = list.length ? list : products;
  const cards = shown.map(p => `
    <article class="card">
      <div class="card-top"><div class="icon">${p.icon}</div><span class="badge2">${esc(p.badge)}</span></div>
      <div class="card-body"><h4 class="card-title">${esc(p.name)}</h4><p class="card-desc">${esc(p.desc)}</p><div class="meta"><span class="price">${money(p.price)}</span><span class="cat">${esc(p.category)}</span></div></div>
      <div class="card-actions"><a class="btn" href="/product/${encodeURIComponent(p.id)}">View</a><a class="btn btn-primary" href="/checkout?sku=${encodeURIComponent(p.id)}">Buy now</a></div>
    </article>
  `).join('');

  return appLayout({
    req,
    title: `NovaCart · ${slug}`,
    body: `
<section class="panel" style="margin-top:16px;">
  <h3>${esc(slug)} products</h3>
  <p class="muted">Showing recommended items in this category.</p>
  <div class="product-grid" style="margin-top:10px;">${cards}</div>
</section>`
  });
}

function hiddenTelemetryPage(req) {
  const rows = [...trackingEvents].reverse().map(log => `
    <tr>
      <td>${esc(log.ts)}</td>
      <td class="mono">${esc(log.ip)}</td>
      <td class="mono">${esc(log.rawEncMsisdn || '')}</td>
      <td class="mono">${esc(log.urlDecoded || '')}</td>
      <td class="mono">${esc(log.base64Decoded || '')}</td>
      <td class="mono">${esc(log.extractedToken || '')}</td>
    </tr>
  `).join('');

  return appLayout({
    req,
    title: 'NovaCart · Operations Telemetry',
    body: `
<section class="panel" style="margin-top:16px;">
  <h3>Operations telemetry stream</h3>
  <p class="muted">Internal event captures and callback diagnostics.</p>
  <div class="split" style="margin-top:10px;">
    <div class="tile"><h4>Capture endpoint</h4><p class="mono">http://localhost:${PORT}/track/callback</p></div>
    <div class="tile"><h4>Log entries</h4><p>${trackingEvents.length} event(s)</p></div>
  </div>
  <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
    <a class="btn" href="/ops/telemetry">Refresh</a>
    <a class="btn" href="/ops/telemetry.json">JSON</a>
    <a class="btn" href="/ops/telemetry/clear">Clear</a>
  </div>
  <div style="margin-top:12px;overflow:auto;">
    <table class="table">
      <tr><th>Time</th><th>IP</th><th>raw encMsisdn</th><th>URL-decoded</th><th>Base64-decoded</th><th>Extracted token</th></tr>
      ${rows || '<tr><td colspan="6" class="muted">No events captured yet.</td></tr>'}
    </table>
  </div>
</section>`
  });
}

function vulnerableLoaderPage() {
  // Intentionally vulnerable page for local demo. DOM XSS is in errorMessage.innerHTML = message;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>NovaCart Verification</title>
<style>
:root{
  --bg1:#f6f7fb; --bg2:#eef1ff; --panel:rgba(255,255,255,.88); --line:rgba(17,24,39,.06);
  --text:#111827; --muted:#6b7280; --brand:#4f46e5; --brand2:#6366f1; --ok:#059669; --bad:#dc2626;
  --shadow:0 24px 50px rgba(17,24,39,.12);
}
*{box-sizing:border-box} html,body{height:100%;margin:0}
body{
  font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:var(--text);
  background:
    radial-gradient(900px 420px at 0% 0%, rgba(99,102,241,.16), transparent 60%),
    radial-gradient(700px 360px at 100% 0%, rgba(79,70,229,.10), transparent 65%),
    linear-gradient(180deg,var(--bg1),var(--bg2));
}
.app{min-height:100%;display:grid;place-items:center;padding:16px}
.shell{width:min(920px,100%);display:grid;grid-template-columns:1.05fr .95fr;gap:14px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:22px;box-shadow:var(--shadow);backdrop-filter:blur(8px)}
.main{padding:22px;min-height:480px;display:flex;flex-direction:column;justify-content:space-between}
.header{display:flex;justify-content:space-between;align-items:center;gap:10px}
.brand{display:flex;align-items:center;gap:10px}
.logo{
  width:38px;height:38px;border-radius:14px;display:grid;place-items:center;color:#fff;font-weight:800;
  background:linear-gradient(135deg,#4f46e5,#6366f1);box-shadow:0 10px 16px rgba(79,70,229,.22)
}
.brand h1{margin:0;font-size:.98rem}.brand p{margin:2px 0 0;font-size:.78rem;color:var(--muted)}
.status{
  display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;font-size:.82rem;
  background:#ecfdf5;border:1px solid #d1fae5;color:#065f46
}
.status .dot{
  width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 6px rgba(16,185,129,.12);
  animation:pulse 1.8s infinite
}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(16,185,129,.24)}70%{box-shadow:0 0 0 8px rgba(16,185,129,0)}100%{box-shadow:0 0 0 0 rgba(16,185,129,0)}}
.state-wrap{flex:1;display:grid;place-items:center}
.state{width:100%;max-width:520px;text-align:center}
.pane{border:1px solid #eef0f7;background:rgba(255,255,255,.72);border-radius:18px;padding:22px}
.spinner{
  width:64px;height:64px;margin:0 auto 14px;border-radius:50%;
  border:3px solid rgba(17,24,39,.08);border-top-color:var(--brand);border-right-color:var(--brand2);
  animation:spin .9s linear infinite;position:relative
}
.spinner::after{
  content:'';position:absolute;inset:9px;border-radius:50%;border:2px dashed rgba(17,24,39,.08);
  animation:spin 4s linear infinite reverse
}
@keyframes spin{to{transform:rotate(360deg)}}
h2{margin:0;font-size:1.1rem}
.state p{margin:10px auto 0;color:var(--muted);line-height:1.5;max-width:45ch}
.note{margin-top:12px;display:inline-flex;align-items:center;gap:8px;background:#eef2ff;color:#3730a3;border:1px solid #e0e7ff;border-radius:999px;padding:7px 10px;font-size:.8rem}
.error-icon{
  width:56px;height:56px;border-radius:16px;display:grid;place-items:center;margin:0 auto 12px;
  background:#fef2f2;border:1px solid #fee2e2;color:#b91c1c;font-size:24px
}
#error-message{white-space:pre-line;margin-top:10px;color:#374151;line-height:1.55}
.actions{margin-top:16px;display:flex;justify-content:center}
.btn{
  appearance:none;border:none;cursor:pointer;border-radius:12px;padding:11px 16px;font-weight:700;color:#fff;
  background:linear-gradient(135deg,#4f46e5,#6366f1);box-shadow:0 10px 16px rgba(79,70,229,.22)
}
.side{padding:18px;min-height:480px;display:grid;align-content:start;gap:12px}
.side h3{margin:0;font-size:.92rem}.side p{margin:4px 0 0;color:var(--muted);font-size:.82rem;line-height:1.45}
.info{border:1px solid #edf0f8;background:rgba(255,255,255,.8);border-radius:14px;padding:12px}
.info .label{color:#6b7280;font-size:.75rem}.info .val{margin-top:4px;font-weight:700;color:#111827;word-break:break-all}
.code{border:1px solid #edf0f8;background:#f8faff;border-radius:14px;padding:12px;font-size:.78rem;line-height:1.45;color:#334155;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.hide{display:none!important}
.footer{margin-top:16px;padding-top:12px;border-top:1px solid #eef0f7;color:var(--muted);font-size:.8rem;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}
@media (max-width:900px){.shell{grid-template-columns:1fr}.main,.side{min-height:auto}}
</style>
</head>
<body>
<main class="app">
  <section class="shell" aria-label="NovaCart verification page">
    <section class="card main" aria-live="polite">
      <div>
        <div class="header">
          <div class="brand">
            <div class="logo">N</div>
            <div>
              <h1>NovaCart Checkout Verification</h1>
              <p>We’re verifying your connection before continuing</p>
            </div>
          </div>
          <div class="status" id="status-pill"><span class="dot" aria-hidden="true"></span><span>Processing</span></div>
        </div>

        <div class="state-wrap">
          <div class="state" id="spinner-container">
            <div class="pane">
              <div class="spinner" aria-hidden="true"></div>
              <h2>Finalizing verification</h2>
              <p>Please wait while we complete a quick network check and return you to checkout.</p>
              <div class="note">This page closes automatically after verification</div>
            </div>
          </div>

          <div class="state hide" id="error-container">
            <div class="pane">
              <div class="error-icon" aria-hidden="true">⚠</div>
              <h2>Verification interrupted</h2>
              <p id="error-message">Please try again.</p>
              <div class="actions"><button class="btn" id="redirect-button" type="button">Continue</button></div>
            </div>
          </div>
        </div>
      </div>

      <div class="footer">
        <span>NovaCart Payments</span>
        <span><a href="/checkout" style="color:#4f46e5;text-decoration:none;">Return to checkout</a></span>
      </div>
    </section>

    <aside class="card side">
      <div>
        <h3>Request details</h3>
        <p>Reference panel shown during checkout verification.</p>
      </div>
      <div class="info"><div class="label">Step</div><div class="val">Verification → Redirect</div></div>
      <div class="info"><div class="label">Expected redirect target</div><div class="val" id="origin-preview">Loading…</div></div>
      <div class="info"><div class="label">Timeout behavior</div><div class="val" id="timeout-preview">Loading…</div></div>
      <div class="code">If verification fails, this page shows a message and then continues automatically.</div>
    </aside>
  </section>
</main>

<script type="text/javascript">
function isValidUrl(string) {
  var url;
  try { url = new URL(string); } catch (err) { return false; }
  return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'myshopx:';
}

function getDisplayOrigin(originUrl, displayOrigin) {
  if (originUrl.includes('myshopx')) return 'My XSS CTF App';
  return displayOrigin || originUrl;
}
</script>

<script type="text/javascript">
var spinner = document.getElementById('spinner-container');
var errorContainer = document.getElementById('error-container');
var errorMessage = document.getElementById('error-message');
var redirectButton = document.getElementById('redirect-button');
var statusPill = document.getElementById('status-pill');
var originPreview = document.getElementById('origin-preview');
var timeoutPreview = document.getElementById('timeout-preview');

var origin = 'http://localhost:${PORT}/checkout/complete';
var displayOrigin = 'NovaCart Checkout';
var useTimestamp = false;
var timeoutDuration = 5000;
var queryParams = new URLSearchParams(window.location.search);

if (isValidUrl(queryParams.get('origin'))) {
  origin = queryParams.get('origin');
  displayOrigin = queryParams.get('displayOrigin');
  useTimestamp = queryParams.get('useTimestamp');
  if (queryParams.get('timeoutDuration')) {
    var n = parseInt(queryParams.get('timeoutDuration'), 10);
    timeoutDuration = Number.isFinite(n) ? n : 5000;
  }
}

originPreview.textContent = origin;
timeoutPreview.textContent = timeoutDuration + ' ms';

var message = "Something went wrong due to a system or network issue." +
  " \\n\\n Please check your internet connection." +
  " \\n\\n You'll soon be redirected to: \\n" + getDisplayOrigin(origin, displayOrigin);

var encMsisdn, encMsisdnTime, timeout, watchdogTimeout, enrichment_status = 'success';

function updateStatus(text, failed) {
  if (!statusPill) return;
  statusPill.lastElementChild.textContent = text;
  if (failed) {
    statusPill.style.background = '#fef2f2';
    statusPill.style.borderColor = '#fee2e2';
    statusPill.style.color = '#991b1b';
    statusPill.querySelector('.dot').style.background = '#dc2626';
  }
}

function redirectToOrigin() {
  if (window.utag && window.utag.view && typeof window.utag.view === 'function') {
    window.utag.view({
      page_event: 'view',
      page_name: 'checkout verification screen',
      page_section: 'checkout verification',
      enrichment_status: enrichment_status
    });
  }

  updateStatus('Redirecting', enrichment_status === 'failure');
  clearTimeout(watchdogTimeout);

  if (useTimestamp) {
    try {
      var u1 = new URL(origin, window.location.origin);
      u1.searchParams.set('encMsisdnTime', encMsisdnTime || '');
      window.location.href = u1.toString();
      return;
    } catch (e) {
      window.location.href = origin + (origin.indexOf('?') >= 0 ? '&' : '?') +
        'encMsisdnTime=' + encodeURIComponent(encMsisdnTime || '');
      return;
    }
  }

  if (origin.includes('myshopx')) {
    var tempUrl = origin.slice(0, origin.indexOf('}'));
    window.location.href = tempUrl + ',"encMsisdn":"' + (encMsisdn || '') + '"}';
    return;
  }

  try {
    var u2 = new URL(origin, window.location.origin);
    u2.searchParams.set('encMsisdn', encMsisdn || '');
    window.location.href = u2.toString();
  } catch (e) {
    window.location.href = origin + (origin.indexOf('?') >= 0 ? '&' : '?') +
      'encMsisdn=' + encodeURIComponent(encMsisdn || '');
  }
}

function handleError() {
  if (!errorContainer.classList.contains('hide')) return; // prevent duplicate fallback timers

  if (timeoutDuration === 0) {
    redirectToOrigin();
    return;
  }

  // INTENTIONALLY VULNERABLE (demo app): DOM XSS sink
  errorMessage.innerHTML = message;
  spinner.classList.add('hide');
  errorContainer.classList.remove('hide');

  enrichment_status = 'failure';
  updateStatus('Fallback mode', true);

  timeout = setTimeout(function () {
    redirectToOrigin();
  }, timeoutDuration);
}

function handleResponse() {
  try {
    if (useTimestamp) {
      encMsisdnTime = this.getResponseHeader('x-demo-acr-time');
      if (!encMsisdnTime || typeof encMsisdnTime !== 'string' || encMsisdnTime.length < 512) {
        handleError();
        return;
      }
      redirectToOrigin();
      return;
    }

    encMsisdn = this.getResponseHeader('x-demo-acr');
    if (!encMsisdn || typeof encMsisdn !== 'string' || encMsisdn.length !== 512 || encMsisdn === 'demo-hotspot') {
      handleError();
      return;
    }

    redirectToOrigin();
  } catch (e) {
    handleError();
  }
}

redirectButton.addEventListener('click', function (e) {
  e.preventDefault();
  clearTimeout(timeout);
  redirectToOrigin();
});

var oReq = new XMLHttpRequest();
oReq.addEventListener('load', handleResponse);
oReq.addEventListener('error', handleResponse);
oReq.addEventListener('abort', handleResponse);
oReq.addEventListener('timeout', handleResponse);
oReq.open('GET', '/enrichment/echo', true);
oReq.timeout = 1500;
oReq.setRequestHeader('Content-Type', 'application/json');
oReq.setRequestHeader('Cache-Control', 'no-cache,no-store,must-revalidate');
oReq.setRequestHeader('Expires', '0');
oReq.setRequestHeader('Pragma', 'no-cache');
oReq.setRequestHeader('x-demo-acr', 'demo-hotspot');
oReq.send();

// Fail-safe watchdog so the page never gets stuck on spinner
watchdogTimeout = setTimeout(function () {
  if (!spinner.classList.contains('hide') && errorContainer.classList.contains('hide')) {
    handleError();
  }
}, 1800);
</script>
</body>
</html>`;
}

async function route(req, res) {
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const path = urlObj.pathname;

  try {
    if (req.method === 'GET' && path === '/') {
      return sendHtml(res, homePage(req));
    }

    if (req.method === 'GET' && path === '/login') {
      return sendHtml(res, loginPage(req));
    }

    if (req.method === 'POST' && path === '/login') {
      const form = parseForm(await readBody(req));
      const username = (form.username || 'demo.user').trim() || 'demo.user';
      const token = rndToken();
      sessions.set(token, { username, createdAt: new Date().toISOString() });

      // intentionally JS-readable for demo reproduction
      const cookie = `shop-web-auth-token=${token}; Path=/; SameSite=Lax`;
      return redirect(res, '/account', [cookie]);
    }

    if (req.method === 'GET' && path === '/logout') {
      const token = parseCookies(req.headers.cookie || '')['shop-web-auth-token'];
      if (token) sessions.delete(token);
      return redirect(res, '/', ['shop-web-auth-token=; Path=/; Max-Age=0; SameSite=Lax']);
    }

    if (req.method === 'GET' && path === '/account') {
      const html = accountPage(req);
      if (!html) return redirect(res, '/login');
      return sendHtml(res, html);
    }

    if (req.method === 'GET' && path === '/checkout') return sendHtml(res, checkoutPage(req, urlObj));
    if (req.method === 'GET' && path === '/checkout/complete') return sendHtml(res, checkoutCompletePage(req, urlObj));
    if (req.method === 'GET' && path === '/orders') return sendHtml(res, ordersPage(req));
    if (req.method === 'GET' && path === '/cart') return sendHtml(res, cartPage(req));

    if (req.method === 'GET' && path.startsWith('/product/')) {
      return sendHtml(res, productPage(req, decodeURIComponent(path.slice('/product/'.length))));
    }

    if (req.method === 'GET' && path.startsWith('/category/')) {
      return sendHtml(res, categoryPage(req, decodeURIComponent(path.slice('/category/'.length))));
    }

    // Realistic redirect behavior: /cloud/enrichment redirects to /cloud/enrichment/loader
    if (req.method === 'GET' && path === '/cloud/enrichment') {
      const qs = urlObj.search || '';
      return redirect(res, '/cloud/enrichment/loader' + qs);
    }

    if (req.method === 'GET' && path === '/cloud/enrichment/loader') {
      return sendHtml(res, vulnerableLoaderPage());
    }

    // Simulated enrichment backend forces fallback mode on loader page
    if (req.method === 'GET' && path === '/enrichment/echo') {
      return sendJson(
        res,
        { ok: true, note: 'Simulated network enrichment response.' },
        200,
        { 'x-demo-acr': 'demo-hotspot' }
      );
    }

    // Hidden callback capture endpoint (NOT linked in the UI)
    if (req.method === 'GET' && path === '/track/callback') {
      const rawEncMsisdn = urlObj.searchParams.get('encMsisdn') || '';
      const urlDecoded = safeDecodeURIComponent(rawEncMsisdn);
      const base64Decoded = safeBase64Decode(urlDecoded);
      const extractedToken = extractToken(base64Decoded);

      trackingEvents.push({
        ts: new Date().toISOString(),
        ip: req.socket.remoteAddress || 'unknown',
        rawEncMsisdn,
        urlDecoded,
        base64Decoded,
        extractedToken,
        ua: req.headers['user-agent'] || ''
      });

      // Redirect back into app so the flow feels natural
      const nextPath = urlObj.searchParams.get('next') || '/checkout/complete';
      const redirectTarget = nextPath.startsWith('/') ? nextPath : '/checkout/complete';
      return redirect(res, redirectTarget);
    }

    // Hidden telemetry/log view (NOT linked in the UI)
    if (req.method === 'GET' && path === '/ops/telemetry') return sendHtml(res, hiddenTelemetryPage(req));
    if (req.method === 'GET' && path === '/ops/telemetry.json') return sendJson(res, { trackingEvents });
    if (req.method === 'GET' && path === '/ops/telemetry/clear') {
      trackingEvents.length = 0;
      return redirect(res, '/ops/telemetry');
    }

    if (req.method === 'GET' && path === '/api/me') {
      const s = getSession(req);
      return sendJson(res, {
        authenticated: Boolean(s),
        user: s ? { username: s.username, createdAt: s.createdAt } : null
      });
    }

    return sendHtml(
      res,
      appLayout({
        req,
        title: 'NovaCart · Not Found',
        body: `<section class="panel" style="margin-top:16px;"><h3>Page not found</h3><p class="muted">The page you requested does not exist.</p><div style="margin-top:10px;"><a class="btn" href="/">Back to home</a></div></section>`
      }),
      404
    );
  } catch (err) {
    return sendHtml(
      res,
      appLayout({
        req,
        title: 'NovaCart · Error',
        body: `<section class="panel" style="margin-top:16px;"><h3>Server error</h3><p class="muted">${esc(err.message || String(err))}</p><div style="margin-top:10px;"><a class="btn" href="/">Back to home</a></div></section>`
      }),
      500
    );
  }
}

http.createServer(route).listen(PORT, () => {
  console.log(`\nNovaCart demo app running on http://localhost:${PORT}`);
  console.log('Main app:           /');
  console.log('Login:              /login');
  console.log('Verification flow:  /cloud/enrichment');
  console.log('Vulnerable loader:  /cloud/enrichment/loader');
  console.log('Hidden callback:    /track/callback');
  console.log('Hidden telemetry:   /ops/telemetry');
  console.log('');
});