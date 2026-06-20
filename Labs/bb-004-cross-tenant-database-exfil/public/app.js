'use strict';

// Meridian console — first-party web app.
//
// Auth here is SESSION based (email + password -> httpOnly cookie). API keys are
// NOT used to sign in; they are minted on the "API keys" page for terminal/API
// use against /v1. A single account can belong to several organizations and must
// pick which one it is working in (the org switcher in the top bar).

const app = document.querySelector('#app');

const state = {
  session: null, // { user, memberships, activeOrgId, activeOrg, role, capabilities }
  authMode: 'login', // 'login' | 'signup'
  pendingInvite: null, // invite code awaiting acceptance after sign-in
  flash: null, // one-shot message to show after the console renders
  view: 'overview',
  databases: [],
  projects: [],
  keys: [],
  members: [],
  backups: [],
  records: [],
  selectedDatabaseId: null
};

// --------------------------------------------------------------------------
// Utilities
// --------------------------------------------------------------------------

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(date) {
  if (!date) return '—';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function showAlert(message, type = 'error', selector = '[data-alert]') {
  const el = document.querySelector(selector);
  if (!el) return;
  el.textContent = message;
  el.className = `alert ${type} show`;
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'same-origin',
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
  });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    const error = new Error((body && body.error) || `Request failed (${response.status}).`);
    error.status = response.status;
    error.code = body && body.code;
    throw error;
  }
  return body;
}

function can(capability) {
  return (state.session?.capabilities || []).includes(capability);
}

function isAdmin() {
  return can('databases:create');
}

function allowedRoles() {
  return state.session?.role === 'admin' ? ['admin', 'reader'] : ['reader'];
}

async function copyToClipboard(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      const original = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => {
        btn.textContent = original;
      }, 1400);
    }
  } catch {
    /* clipboard may be unavailable; the value is visible anyway */
  }
}

// --------------------------------------------------------------------------
// Modal helper
// --------------------------------------------------------------------------

function openModal(title, bodyHtml) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h2>${escapeHtml(title)}</h2>
        <button class="icon-btn" data-modal-close aria-label="Close">✕</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
    </div>
  `;
  const close = () => wrap.remove();
  wrap.addEventListener('click', (event) => {
    if (event.target === wrap) close();
  });
  wrap.querySelector('[data-modal-close]').addEventListener('click', close);
  document.body.appendChild(wrap);
  return { el: wrap, close };
}

// --------------------------------------------------------------------------
// Boot / routing
// --------------------------------------------------------------------------

async function boot() {
  const joinMatch = window.location.pathname.match(/^\/join\/([^/]+)/);
  if (joinMatch) {
    state.pendingInvite = decodeURIComponent(joinMatch[1]);
  }

  let session = null;
  try {
    session = await api('/app/session');
  } catch {
    session = null;
  }

  if (!session) {
    return renderAuth();
  }
  state.session = session;
  return routeAfterSession();
}

async function routeAfterSession() {
  // A pending invite means the user followed a /join/<code> link.
  if (state.pendingInvite) {
    try {
      state.session = await api(`/app/invites/${encodeURIComponent(state.pendingInvite)}/accept`, { method: 'POST' });
      state.pendingInvite = null;
      window.history.replaceState({}, '', '/');
    } catch (err) {
      state.pendingInvite = null;
      window.history.replaceState({}, '', '/');
      // Fall through to normal routing; surface the reason once the console renders.
      state.flash = err.message;
    }
  }

  if (!state.session.activeOrgId) {
    return renderOrgPicker();
  }
  await loadOrgData();
  renderConsole();
  if (state.flash) {
    showAlert(state.flash, 'error');
    state.flash = null;
  }
}

async function loadOrgData() {
  const orgId = state.session.activeOrgId;
  state.databases = can('databases:list')
    ? (await api(`/v1/orgs/${orgId}/databases`).catch(() => ({ databases: [] }))).databases || []
    : [];
  state.projects = can('projects:list')
    ? (await api(`/v1/orgs/${orgId}/projects`).catch(() => ({ projects: [] }))).projects || []
    : [];
  state.keys = can('keys:list')
    ? (await api(`/v1/orgs/${orgId}/keys`).catch(() => ({ keys: [] }))).keys || []
    : [];
  state.members = (await api(`/v1/orgs/${orgId}/members`).catch(() => ({ members: [] }))).members || [];

  if (!state.selectedDatabaseId && state.databases.length) {
    state.selectedDatabaseId = state.databases[0].id;
  }
  if (state.selectedDatabaseId && !state.databases.some((d) => d.id === state.selectedDatabaseId)) {
    state.selectedDatabaseId = state.databases[0]?.id || null;
  }
  await loadDatabaseDetail();
}

async function loadDatabaseDetail() {
  state.backups = [];
  state.records = [];
  if (!state.selectedDatabaseId) return;
  const orgId = state.session.activeOrgId;
  const id = state.selectedDatabaseId;
  if (can('backups:list')) {
    state.backups = (await api(`/v1/orgs/${orgId}/databases/${id}/backups`).catch(() => ({ backups: [] }))).backups || [];
  }
  if (can('records:read')) {
    state.records = (await api(`/v1/orgs/${orgId}/databases/${id}/records`).catch(() => ({ records: [] }))).records || [];
  }
}

// --------------------------------------------------------------------------
// Auth (login / signup)
// --------------------------------------------------------------------------

function renderAuth() {
  const inviteBanner = state.pendingInvite
    ? `<div class="invite-banner">You've been invited to join an organization. Sign in or create an account to accept it.</div>`
    : '';

  app.innerHTML = `
    <main class="auth-layout">
      <section class="auth-hero">
        <div class="brand"><span class="brand-mark"></span><span>Meridian</span></div>
        <div class="auth-hero-copy">
          <span class="eyebrow">Managed databases · multi-tenant</span>
          <h1>One workspace per organization. Isolated by design.</h1>
          <p>Provision databases, schedule immutable backups, and issue scoped API keys for the tools and contractors that need them — all from a single console.</p>
        </div>
        <ul class="auth-feature-list">
          <li><span class="dot"></span> Per-tenant databases &amp; point-in-time backups</li>
          <li><span class="dot"></span> Role-based access — admin &amp; read-only</li>
          <li><span class="dot"></span> Self-service API keys for the terminal &amp; CI</li>
        </ul>
        <div class="lab-banner">⚠ Security lab — intentionally vulnerable. Do not deploy publicly.</div>
      </section>

      <section class="auth-panel">
        <div class="auth-card">
          <div class="auth-switch">
            <button class="auth-tab ${state.authMode === 'login' ? 'active' : ''}" data-mode="login">Sign in</button>
            <button class="auth-tab ${state.authMode === 'signup' ? 'active' : ''}" data-mode="signup">Create account</button>
          </div>
          ${inviteBanner}
          <div data-alert class="alert"></div>
          ${state.authMode === 'login' ? loginForm() : signupForm()}
        </div>
      </section>
    </main>
  `;

  document.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.authMode = btn.dataset.mode;
      renderAuth();
    });
  });

  document.querySelector('[data-login-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      state.session = await api('/app/login', {
        method: 'POST',
        body: { email: form.get('email'), password: form.get('password') }
      });
      await routeAfterSession();
    } catch (err) {
      showAlert(err.message || 'Could not sign in.');
    }
  });

  document.querySelector('[data-signup-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      state.session = await api('/app/signup', {
        method: 'POST',
        body: {
          name: form.get('name'),
          email: form.get('email'),
          password: form.get('password'),
          orgName: form.get('orgName')
        }
      });
      await routeAfterSession();
    } catch (err) {
      showAlert(err.message || 'Could not create your account.');
    }
  });
}

function loginForm() {
  return `
    <h2>Welcome back</h2>
    <p class="sub">Sign in to your Meridian console.</p>
    <form class="form-stack" data-login-form>
      <label class="field"><span>Email</span><input class="input" name="email" type="email" placeholder="you@company.test" autocomplete="username" required /></label>
      <label class="field"><span>Password</span><input class="input" name="password" type="password" placeholder="••••••••" autocomplete="current-password" required /></label>
      <button class="btn btn-primary" type="submit">Sign in</button>
    </form>
  `;
}

function signupForm() {
  return `
    <h2>Create your account</h2>
    <p class="sub">Provision a new organization. You become its admin — create a second account later to play the other side of the cross-tenant scenario.</p>
    <form class="form-stack" data-signup-form>
      <label class="field"><span>Your name</span><input class="input" name="name" type="text" placeholder="Dana Okafor" required /></label>
      <label class="field"><span>Email</span><input class="input" name="email" type="email" placeholder="dana@atlas-labs.test" autocomplete="username" required /></label>
      <label class="field"><span>Password <span class="hint">(min 8 characters)</span></span><input class="input" name="password" type="password" placeholder="••••••••" autocomplete="new-password" minlength="8" required /></label>
      <label class="field"><span>Organization name</span><input class="input" name="orgName" type="text" placeholder="Atlas Labs" required /></label>
      <button class="btn btn-primary" type="submit">Create account</button>
    </form>
  `;
}

// --------------------------------------------------------------------------
// Organization picker (multi-org accounts choose where to work)
// --------------------------------------------------------------------------

function renderOrgPicker() {
  const memberships = state.session.memberships || [];
  app.innerHTML = `
    <div class="centered-layout">
      <div class="centered-card">
        <div class="brand"><span class="brand-mark"></span><span>Meridian</span></div>
        <h1>Choose an organization</h1>
        <p class="sub">Your account belongs to ${memberships.length} organization${memberships.length === 1 ? '' : 's'}. Pick which one to work in — you can switch any time.</p>
        <div data-alert class="alert"></div>
        <div class="org-choices">
          ${memberships.map((m) => `
            <button class="org-choice" data-pick-org="${escapeHtml(m.orgId)}">
              <span class="org-choice-avatar">${escapeHtml(initials(m.name))}</span>
              <span class="org-choice-text">
                <strong>${escapeHtml(m.name)}</strong>
                <span class="org-choice-id">${escapeHtml(m.orgId)}</span>
              </span>
              <span class="role-badge ${m.role}">${escapeHtml(m.role)}</span>
            </button>
          `).join('')}
        </div>
        <button class="btn btn-soft" data-create-org style="width:100%;margin-top:6px;">+ Create a new organization</button>
        <button class="btn btn-ghost" data-logout style="width:100%;margin-top:10px;">Sign out</button>
      </div>
    </div>
  `;

  document.querySelectorAll('[data-pick-org]').forEach((btn) => {
    btn.addEventListener('click', () => selectOrg(btn.dataset.pickOrg));
  });
  document.querySelector('[data-create-org]')?.addEventListener('click', promptCreateOrg);
  document.querySelector('[data-logout]')?.addEventListener('click', logout);
}

async function selectOrg(orgId) {
  try {
    state.session = await api('/app/session/org', { method: 'POST', body: { orgId } });
    state.selectedDatabaseId = null;
    state.view = 'overview';
    await loadOrgData();
    renderConsole();
  } catch (err) {
    showAlert(err.message || 'Could not switch organization.');
  }
}

function promptCreateOrg() {
  const modal = openModal('Create organization', `
    <p class="sub">You'll become the admin of this new organization and switch to it right away.</p>
    <div data-alert-modal class="alert"></div>
    <form class="form-stack" data-create-org-form>
      <label class="field"><span>Organization name</span><input class="input" name="orgName" type="text" placeholder="Northstar Analytics" required /></label>
      <button class="btn btn-primary" type="submit">Create organization</button>
    </form>
  `);
  modal.el.querySelector('[data-create-org-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const orgName = new FormData(event.currentTarget).get('orgName');
    try {
      state.session = await api('/app/orgs', { method: 'POST', body: { orgName } });
      modal.close();
      state.selectedDatabaseId = null;
      state.view = 'overview';
      await loadOrgData();
      renderConsole();
    } catch (err) {
      showAlert(err.message || 'Could not create organization.', 'error', '[data-alert-modal]');
    }
  });
}

async function logout() {
  try {
    await api('/app/logout', { method: 'POST' });
  } catch {
    /* ignore */
  }
  state.session = null;
  state.authMode = 'login';
  renderAuth();
}

// --------------------------------------------------------------------------
// Console shell
// --------------------------------------------------------------------------

const NAV_ITEMS = [
  { id: 'overview', label: 'Overview', icon: 'grid' },
  { id: 'databases', label: 'Databases', icon: 'db' },
  { id: 'backups', label: 'Backups', icon: 'save' },
  { id: 'members', label: 'Members', icon: 'users' },
  { id: 'keys', label: 'API keys', icon: 'key' }
];

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h7V3"/><rect x="8" y="13" width="8" height="5"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 6"/><path d="M17 14.5a5.5 5.5 0 0 1 3.5 5.5"/>',
  key: '<circle cx="8" cy="8" r="4.5"/><path d="M11.2 11.2 20 20"/><path d="M16.5 16.5 19 14M14.5 14.5 17 12"/>'
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
}

function renderConsole() {
  const s = state.session;
  const org = s.activeOrg;
  const memberships = s.memberships || [];

  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><span class="brand-mark"></span><span>Meridian</span></div>
        <nav class="side-nav">
          ${NAV_ITEMS.map((item) => `
            <button class="nav-item ${state.view === item.id ? 'active' : ''}" data-nav="${item.id}">
              ${icon(item.icon)}<span>${item.label}</span>
            </button>
          `).join('')}
        </nav>
        <div class="sidebar-foot">
          <div class="lab-pill">⚠ Vulnerable lab build</div>
        </div>
      </aside>

      <div class="main-col">
        <header class="topbar">
          <details class="dropdown org-switcher">
            <summary>
              <span class="org-avatar">${escapeHtml(initials(org.name))}</span>
              <span class="org-switch-text">
                <strong>${escapeHtml(org.name)}</strong>
                <span class="role-badge ${org.role}">${escapeHtml(org.role)}</span>
              </span>
              <span class="caret">▾</span>
            </summary>
            <div class="dropdown-menu">
              <div class="dropdown-label">Switch organization</div>
              ${memberships.map((m) => `
                <button class="dropdown-item ${m.orgId === org.id ? 'current' : ''}" data-switch-org="${escapeHtml(m.orgId)}">
                  <span class="org-avatar sm">${escapeHtml(initials(m.name))}</span>
                  <span class="dropdown-item-text"><strong>${escapeHtml(m.name)}</strong><span>${escapeHtml(m.role)}</span></span>
                  ${m.orgId === org.id ? '<span class="check">✓</span>' : ''}
                </button>
              `).join('')}
              <button class="dropdown-item" data-create-org><span class="org-avatar sm plus">+</span><span class="dropdown-item-text"><strong>Create organization</strong></span></button>
            </div>
          </details>

          <details class="dropdown user-menu">
            <summary>
              <span class="user-avatar">${escapeHtml(initials(s.user.name))}</span>
              <span class="user-text"><strong>${escapeHtml(s.user.name)}</strong><span>${escapeHtml(s.user.email)}</span></span>
              <span class="caret">▾</span>
            </summary>
            <div class="dropdown-menu align-right">
              <div class="dropdown-userblock">
                <strong>${escapeHtml(s.user.name)}</strong>
                <span>${escapeHtml(s.user.email)}</span>
              </div>
              <button class="dropdown-item danger" data-logout><span>Sign out</span></button>
            </div>
          </details>
        </header>

        <main class="content">${renderView()}</main>
      </div>
    </div>
  `;

  bindConsoleEvents();
}

function renderView() {
  switch (state.view) {
    case 'databases':
      return viewDatabases();
    case 'backups':
      return viewBackups();
    case 'members':
      return viewMembers();
    case 'keys':
      return viewApiKeys();
    default:
      return viewOverview();
  }
}

// --------------------------------------------------------------------------
// Views
// --------------------------------------------------------------------------

function pageHead(eyebrow, title, sub) {
  return `
    <div class="page-head">
      <span class="eyebrow">${escapeHtml(eyebrow)}</span>
      <h1>${escapeHtml(title)}</h1>
      <p>${sub}</p>
    </div>
  `;
}

function viewOverview() {
  const totalRecords = state.databases.reduce((sum, d) => sum + (d.recordCount || 0), 0);
  return `
    ${pageHead('Overview', `${escapeHtml(state.session.activeOrg.name)}`,
      `Signed in as <strong>${escapeHtml(state.session.user.name)}</strong> with the <strong>${escapeHtml(state.session.role)}</strong> role. ${isAdmin()
        ? 'You can create databases, run backups, manage members and mint API keys.'
        : 'Read-only access — browse database and backup metadata, but records stay hidden and you cannot create databases.'}`)}
    <div class="stat-grid">
      <div class="stat-card"><span>Databases</span><strong>${state.databases.length}</strong></div>
      <div class="stat-card"><span>Records ${isAdmin() ? '' : '<span class="hint">(metadata)</span>'}</span><strong>${totalRecords}</strong></div>
      <div class="stat-card"><span>Members</span><strong>${state.members.length}</strong></div>
      <div class="stat-card"><span>Your role</span><strong class="cap">${escapeHtml(state.session.role)}</strong></div>
    </div>
    <div class="panel">
      <div class="section-head"><div><h2>Getting started</h2><p>Build a tenant, then attempt the cross-tenant restore from a second account.</p></div></div>
      <ol class="steps">
        <li>Go to <strong>Databases</strong> → provision a database and add records (include a <code>note: CROSS_TENANT_PROOF</code> marker).</li>
        <li>Open <strong>Backups</strong> → back it up and copy the backup id.</li>
        <li>Create a second account (a different org), then provision a database <em>restoring</em> it from the first org's backup id.</li>
        <li>Need terminal access? Mint a key on the <strong>API keys</strong> page and drive <code>/v1</code> with <code>Authorization: Bearer mk_…</code>.</li>
      </ol>
    </div>
  `;
}

function databaseOptions() {
  return state.databases
    .map((d) => `<option value="${escapeHtml(d.id)}" ${d.id === state.selectedDatabaseId ? 'selected' : ''}>${escapeHtml(d.name)}</option>`)
    .join('');
}

function viewDatabases() {
  const selected = state.databases.find((d) => d.id === state.selectedDatabaseId) || null;
  return `
    ${pageHead('Databases', 'Databases', 'Per-tenant data containers. Provision a new one — admins can restore it from an existing backup.')}
    <div class="grid-2">
      <div class="panel">
        <div class="section-head"><div><h2>Your databases</h2><p>${state.databases.length} in ${escapeHtml(state.session.activeOrg.name)}.</p></div></div>
        <div class="data-list">
          ${state.databases.length ? state.databases.map(databaseCard).join('') : '<div class="empty">No databases yet.</div>'}
        </div>
        ${selected ? recordsBlock(selected) : ''}
      </div>
      <div class="panel">
        <div class="section-head"><div><h2>Provision database</h2><p>Create a fresh database or restore from a backup id.</p></div></div>
        <div data-alert class="alert"></div>
        ${isAdmin() ? newDatabaseForm() : '<div class="empty">Read-only keys cannot create databases.</div>'}
      </div>
    </div>
  `;
}

function databaseCard(database) {
  const selected = database.id === state.selectedDatabaseId;
  return `
    <button class="data-card ${selected ? 'selected' : ''}" data-database="${escapeHtml(database.id)}" type="button">
      <div class="data-card-top">
        <div>
          <h3>${escapeHtml(database.name)}</h3>
          <span class="meta">${escapeHtml(database.id)}</span>
        </div>
        <span class="badge ${database.restoredFromBackupId ? 'warn' : 'muted'}">${database.recordCount} records</span>
      </div>
      <div class="chip-row">
        <span class="meta-chip">${escapeHtml(database.state || 'ready')}</span>
        <span class="meta-chip">${escapeHtml(formatDate(database.createdAt))}</span>
        ${database.restoredFromBackupId ? '<span class="meta-chip warn">restored from backup</span>' : ''}
      </div>
    </button>
  `;
}

function recordsBlock(database) {
  if (!isAdmin()) {
    return `<hr class="divider" /><div class="note">Connected as <strong>reader</strong>: record contents are hidden. You can see that <strong>${escapeHtml(database.name)}</strong> holds <strong>${database.recordCount}</strong> records and list its backups.</div>`;
  }
  const cols = state.records.length ? Object.keys(state.records[0].fields || {}) : [];
  const table = state.records.length
    ? `<div class="table-wrap">
        <table class="table">
          <thead><tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
          <tbody>
            ${state.records.map((r) => `<tr>${cols.map((c) => {
              const value = r.fields[c];
              const isProof = typeof value === 'string' && /CROSS_TENANT_PROOF|private_data/i.test(value);
              return `<td class="${isProof ? 'proof' : ''}">${escapeHtml(value)}</td>`;
            }).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>`
    : '<div class="empty">No records yet. Add one below to populate this database.</div>';

  return `
    <hr class="divider" />
    <div class="section-head"><div><h2>${escapeHtml(database.name)} · records</h2><p>${state.records.length} row${state.records.length === 1 ? '' : 's'}.</p></div></div>
    ${table}
    <form class="form-stack" data-record-form data-database-id="${escapeHtml(database.id)}" style="margin-top:14px;">
      <label class="field">
        <span>Add record <span class="hint">— one "field: value" per line</span></span>
        <textarea class="textarea mono" name="fields" placeholder="customer: Helix Manufacturing&#10;email: ap@helixmfg.example&#10;note: CROSS_TENANT_PROOF" required></textarea>
      </label>
      <button class="btn btn-soft" type="submit">Add record</button>
    </form>
  `;
}

function parseFields(text) {
  const fields = {};
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key) fields[key] = value;
  }
  return fields;
}

function newDatabaseForm() {
  return `
    <form class="form-stack" data-database-form>
      <label class="field">
        <span>Database name</span>
        <input class="input" name="name" type="text" placeholder="customer-ledger-restore" required />
      </label>
      <label class="field">
        <span>Project <span class="hint">(optional — must belong to this org)</span></span>
        <select class="select" name="projectId">
          <option value="">No project</option>
          ${state.projects.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} — ${escapeHtml(p.id)}</option>`).join('')}
        </select>
      </label>
      <label class="field">
        <span>Restore from backup id <span class="hint">(optional — restores the backup's records)</span></span>
        <input class="input mono" name="sourceBackupId" type="text" placeholder="paste a backup id (uuid)" autocomplete="off" />
      </label>
      <button class="btn btn-primary" type="submit">Provision database</button>
    </form>
  `;
}

function viewBackups() {
  const selected = state.databases.find((d) => d.id === state.selectedDatabaseId) || null;
  return `
    ${pageHead('Backups', 'Database backups', "Immutable point-in-time copies of a database's records. Their ids are visible to read-only keys.")}
    <div class="panel">
      <div class="section-head">
        <div><h2>Database</h2><p>Choose a database to view its backups.</p></div>
        ${state.databases.length ? `<select class="select" data-database-select style="max-width:280px;">${databaseOptions()}</select>` : ''}
      </div>
      ${selected ? `
        <div class="data-list">
          ${state.backups.length ? state.backups.map(backupCard).join('') : '<div class="empty">No backups for this database yet.</div>'}
        </div>
        ${isAdmin() ? `
          <hr class="divider" />
          <div data-alert class="alert"></div>
          <button class="btn btn-soft" data-run-backup>Back up now</button>
          <p class="note" style="margin-top:10px;">Creates a new immutable backup of <strong>${escapeHtml(selected.name)}</strong>'s current records.</p>
        ` : '<p class="note" style="margin-top:14px;">Read-only keys can read backup ids but cannot run backups.</p>'}
      ` : '<div class="empty">No databases available.</div>'}
    </div>
  `;
}

function backupCard(item) {
  return `
    <div class="data-card static">
      <div class="data-card-top">
        <div>
          <h3>${escapeHtml(item.name)}</h3>
          <span class="meta">${escapeHtml(item.id)}</span>
        </div>
        <div class="card-actions">
          <span class="badge">${item.recordCount} records</span>
          <button class="btn btn-ghost btn-sm" data-copy-backup="${escapeHtml(item.id)}">Copy id</button>
        </div>
      </div>
      <div class="chip-row">
        <span class="meta-chip">${escapeHtml(formatDate(item.createdAt))}</span>
        <span class="meta-chip">${Math.round((item.sizeBytes || 0) / 1024)} KB</span>
      </div>
    </div>
  `;
}

function viewMembers() {
  return `
    ${pageHead('Members', 'Members &amp; access', `People in <strong>${escapeHtml(state.session.activeOrg.name)}</strong>. Invite teammates or contractors at or below your own role (<strong>${escapeHtml(state.session.role)}</strong>).`)}
    <div class="grid-2">
      <div class="panel">
        <div class="section-head"><div><h2>Team</h2><p>${state.members.length} member${state.members.length === 1 ? '' : 's'}.</p></div></div>
        <div class="data-list">
          ${state.members.map(memberCard).join('') || '<div class="empty">No members.</div>'}
        </div>
      </div>
      <div class="panel">
        <div class="section-head"><div><h2>Invite a member</h2><p>Generate a one-time join link — no email is sent in this lab.</p></div></div>
        ${can('invites:create') ? `
          <div data-alert-invite class="alert"></div>
          <form class="form-stack" data-invite-form>
            <label class="field"><span>Role</span><select class="select" name="role">${roleOptions()}</select></label>
            <button class="btn btn-primary" type="submit">Generate invite link</button>
          </form>
          <div data-invite-result></div>
        ` : '<div class="empty">This role cannot generate invites.</div>'}
      </div>
    </div>
  `;
}

function memberCard(member) {
  const you = member.userId === state.session.user.id;
  return `
    <div class="data-card static">
      <div class="data-card-top">
        <div class="member-id">
          <span class="user-avatar sm">${escapeHtml(initials(member.name))}</span>
          <div>
            <h3>${escapeHtml(member.name)}${you ? ' <span class="you-tag">you</span>' : ''}</h3>
            <span class="meta">${escapeHtml(member.email || '—')}</span>
          </div>
        </div>
        <span class="role-badge ${member.role}">${escapeHtml(member.role)}</span>
      </div>
    </div>
  `;
}

function roleOptions() {
  const labels = {
    reader: 'reader — read-only (monitoring, BI, contractors)',
    admin: 'admin — full control'
  };
  return allowedRoles().map((role) => `<option value="${role}">${labels[role]}</option>`).join('');
}

function viewApiKeys() {
  const orgId = state.session.activeOrgId;
  return `
    ${pageHead('API keys', 'API keys', 'Keys authenticate the <strong>programmatic API</strong> (<code>/v1</code>) from your terminal, scripts and CI — they are <strong>not</strong> a way to sign in to this console. Each key carries a role and is scoped to this organization.')}
    <div class="grid-2">
      <div class="panel">
        <div class="section-head"><div><h2>Your keys</h2><p>${state.keys.length} key${state.keys.length === 1 ? '' : 's'} in ${escapeHtml(state.session.activeOrg.name)}. Tokens are masked after creation.</p></div></div>
        <div class="data-list">
          ${state.keys.length ? state.keys.map(keyCard).join('') : '<div class="empty">No keys yet.</div>'}
        </div>
      </div>
      <div class="panel">
        <div class="section-head"><div><h2>Create a key</h2><p>The secret is shown once, at creation.</p></div></div>
        ${can('keys:create') ? `
          <div data-alert class="alert"></div>
          <form class="form-stack" data-key-form>
            <label class="field"><span>Key name</span><input class="input" name="name" type="text" placeholder="CI pipeline key" required /></label>
            <label class="field"><span>Role</span><select class="select" name="role">${roleOptions()}</select></label>
            <button class="btn btn-primary" type="submit">Create API key</button>
          </form>
          <div data-key-result></div>
        ` : '<div class="empty">This role cannot create API keys.</div>'}
        <hr class="divider" />
        <div class="section-head"><div><h2>Use it from the terminal</h2><p>Organization id <code class="copyable" data-copy-text="${escapeHtml(orgId)}">${escapeHtml(orgId)}</code></p></div></div>
        <pre class="code-block">curl -H "Authorization: Bearer mk_…" \\
  ${escapeHtml(window.location.origin)}/v1/orgs/${escapeHtml(orgId)}/databases</pre>
      </div>
    </div>
  `;
}

function keyCard(key) {
  return `
    <div class="data-card static">
      <div class="data-card-top">
        <div>
          <h3>${escapeHtml(key.name)}</h3>
          <span class="meta">${escapeHtml(key.tokenMasked)}</span>
        </div>
        <span class="badge ${key.role === 'admin' ? '' : 'warn'}">${escapeHtml(key.role)}</span>
      </div>
      <div class="chip-row">
        <span class="meta-chip">${escapeHtml(formatDate(key.createdAt))}</span>
        ${can('keys:revoke') ? `<button class="btn btn-ghost btn-sm" data-revoke="${escapeHtml(key.id)}">Revoke</button>` : ''}
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------
// Console event wiring
// --------------------------------------------------------------------------

function closeDropdowns() {
  document.querySelectorAll('details.dropdown[open]').forEach((d) => d.removeAttribute('open'));
}

function bindConsoleEvents() {
  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.view = btn.dataset.nav;
      renderConsole();
    });
  });

  document.querySelectorAll('[data-switch-org]').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeDropdowns();
      if (btn.dataset.switchOrg !== state.session.activeOrgId) selectOrg(btn.dataset.switchOrg);
    });
  });
  document.querySelector('[data-create-org]')?.addEventListener('click', () => {
    closeDropdowns();
    promptCreateOrg();
  });
  document.querySelector('[data-logout]')?.addEventListener('click', logout);

  // Close any open dropdown when clicking elsewhere.
  document.addEventListener('click', (event) => {
    document.querySelectorAll('details.dropdown[open]').forEach((d) => {
      if (!d.contains(event.target)) d.removeAttribute('open');
    });
  });

  document.querySelectorAll('[data-database]').forEach((card) => {
    card.addEventListener('click', async () => {
      state.selectedDatabaseId = card.dataset.database;
      await loadDatabaseDetail();
      renderConsole();
    });
  });

  document.querySelector('[data-database-select]')?.addEventListener('change', async (event) => {
    state.selectedDatabaseId = event.target.value;
    await loadDatabaseDetail();
    renderConsole();
  });

  document.querySelector('[data-database-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = { name: form.get('name') };
    if (form.get('projectId')) body.projectId = form.get('projectId');
    if (form.get('sourceBackupId')) body.sourceBackupId = form.get('sourceBackupId').trim();
    try {
      const result = await api(`/v1/orgs/${state.session.activeOrgId}/databases`, { method: 'POST', body });
      state.selectedDatabaseId = result.database.id;
      await loadOrgData();
      renderConsole();
      showAlert(`Provisioned “${result.database.name}” with ${result.database.recordCount} records.`, 'success');
    } catch (err) {
      showAlert(err.message || 'Could not provision database.');
    }
  });

  document.querySelector('[data-record-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = parseFields(new FormData(form).get('fields'));
    if (!Object.keys(fields).length) {
      showAlert('Add at least one "field: value" line.');
      return;
    }
    try {
      await api(`/v1/orgs/${state.session.activeOrgId}/databases/${form.dataset.databaseId}/records`, {
        method: 'POST',
        body: { fields }
      });
      await loadOrgData();
      renderConsole();
      showAlert('Record added.', 'success');
    } catch (err) {
      showAlert(err.message || 'Could not add record.');
    }
  });

  document.querySelector('[data-run-backup]')?.addEventListener('click', async () => {
    try {
      await api(`/v1/orgs/${state.session.activeOrgId}/databases/${state.selectedDatabaseId}/backups`, { method: 'POST', body: {} });
      await loadDatabaseDetail();
      renderConsole();
      showAlert('Backup created.', 'success');
    } catch (err) {
      showAlert(err.message || 'Could not run backup.');
    }
  });

  document.querySelectorAll('[data-copy-backup]').forEach((btn) => {
    btn.addEventListener('click', () => copyToClipboard(btn.dataset.copyBackup, btn));
  });
  document.querySelectorAll('[data-copy-text]').forEach((el) => {
    el.addEventListener('click', () => copyToClipboard(el.dataset.copyText, null));
  });

  document.querySelector('[data-key-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const result = await api(`/v1/orgs/${state.session.activeOrgId}/keys`, {
        method: 'POST',
        body: { name: form.get('name'), role: form.get('role') }
      });
      const box = document.querySelector('[data-key-result]');
      box.innerHTML = `
        <hr class="divider" />
        <div class="section-head"><div><h2>New ${escapeHtml(result.key.role)} key</h2><p>Copy it now — it is shown only once.</p></div></div>
        <div class="code-box"><span>${escapeHtml(result.key.token)}</span><button class="btn btn-soft btn-sm" data-copy-key>Copy</button></div>
      `;
      box.querySelector('[data-copy-key]').addEventListener('click', (e) => copyToClipboard(result.key.token, e.currentTarget));
      state.keys = (await api(`/v1/orgs/${state.session.activeOrgId}/keys`).catch(() => ({ keys: state.keys }))).keys || state.keys;
    } catch (err) {
      showAlert(err.message || 'Could not create key.');
    }
  });

  document.querySelectorAll('[data-revoke]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/v1/orgs/${state.session.activeOrgId}/keys/${btn.dataset.revoke}`, { method: 'DELETE' });
        await loadOrgData();
        renderConsole();
        showAlert('API key revoked.', 'success');
      } catch (err) {
        showAlert(err.message || 'Could not revoke key.');
      }
    });
  });

  document.querySelector('[data-invite-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const role = new FormData(event.currentTarget).get('role');
    try {
      const result = await api(`/v1/orgs/${state.session.activeOrgId}/invites`, { method: 'POST', body: { role } });
      const box = document.querySelector('[data-invite-result]');
      box.innerHTML = `
        <hr class="divider" />
        <div class="section-head"><div><h2>Invite link</h2><p>Share this one-time link. Role: <strong>${escapeHtml(result.invite.role)}</strong>.</p></div></div>
        <div class="code-box"><span>${escapeHtml(result.invite.url)}</span><button class="btn btn-soft btn-sm" data-copy-invite>Copy</button></div>
        <p class="note" style="margin-top:10px;">The invitee signs in (or creates an account) and is added to this organization.</p>
      `;
      box.querySelector('[data-copy-invite]').addEventListener('click', (e) => copyToClipboard(result.invite.url, e.currentTarget));
    } catch (err) {
      showAlert(err.message || 'Could not generate invite.', 'error', '[data-alert-invite]');
    }
  });
}

boot();
