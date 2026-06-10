const app = document.querySelector('#app');

const state = {
  user: null,
  projects: [],
  authMode: 'login',
  selectedProjectId: null,
  loading: false
};

const statusMessages = {
  google_not_configured: 'Google sign-in is not available right now.',
  google_auth_failed: 'Google sign-in could not be completed.'
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function initials(nameOrEmail) {
  const value = String(nameOrEmail || 'User').trim();
  const parts = value.split(/[\s@.]+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'U';
}

function formatDate(date) {
  if (!date) return 'No due date';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return 'No due date';
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function showAlert(message, type = 'error') {
  const el = document.querySelector('[data-alert]');
  if (!el) return;
  el.textContent = message;
  el.className = `alert ${type} show`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    credentials: 'same-origin',
    ...options,
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
  });

  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : null;

  if (!response.ok) {
    const error = new Error(body?.error || 'Request failed.');
    error.status = response.status;
    throw error;
  }

  return body;
}

async function boot() {
  const params = new URLSearchParams(window.location.search);
  const error = params.get('error');
  if (error) {
    window.history.replaceState({}, '', '/');
  }

  try {
    const me = await api('/api/me');
    state.user = me.user;
    if (state.user) {
      await loadProjects();
    }
    render();
    if (error && statusMessages[error]) showAlert(statusMessages[error]);
  } catch (err) {
    render();
    showAlert(err.message || 'Could not load the application.');
  }
}

async function loadProjects() {
  const result = await api('/api/projects');
  state.projects = result.projects || [];
  if (!state.selectedProjectId && state.projects.length) {
    state.selectedProjectId = state.projects[0].id;
  }
}

function render() {
  if (!state.user) {
    return renderAuth();
  }
  return renderWorkspace();
}

function renderAuth() {
  app.innerHTML = `
    <main class="auth-layout">
      <section class="auth-hero">
        <div class="brand"><span class="brand-mark"></span><span>WorkNest</span></div>
        <div class="hero-copy">
          <span class="eyebrow">Client work, simplified</span>
          <h1>Plan work without losing the thread.</h1>
          <p>Organize project notes, task lists, and delivery dates from one clean workspace built for small teams and independent operators.</p>
        </div>
        <div class="hero-grid">
          <div class="hero-tile"><strong>12k+</strong><span>Tasks organized monthly</span></div>
          <div class="hero-tile"><strong>4.8</strong><span>Average team rating</span></div>
          <div class="hero-tile"><strong>30%</strong><span>Fewer missed handoffs</span></div>
        </div>
      </section>

      <section class="auth-card-wrap">
        <div class="auth-card">
          <div class="auth-tabs">
            <button class="auth-tab ${state.authMode === 'login' ? 'active' : ''}" data-auth-tab="login">Sign in</button>
            <button class="auth-tab ${state.authMode === 'register' ? 'active' : ''}" data-auth-tab="register">Create account</button>
          </div>
          <div data-alert class="alert"></div>
          ${state.authMode === 'login' ? loginForm() : registerForm()}
        </div>
      </section>
    </main>
  `;

  bindAuthEvents();
}

function loginForm() {
  return `
    <form class="form-stack" data-login-form>
      <div class="form-head">
        <h2>Welcome back</h2>
        <p>Pick up from your latest workspace and keep delivery moving.</p>
      </div>
      <label class="field">
        <span>Email address</span>
        <input class="input" name="email" type="email" autocomplete="email" placeholder="you@company.com" required />
      </label>
      <label class="field">
        <span>Password</span>
        <input class="input" name="password" type="password" autocomplete="current-password" placeholder="••••••••" required />
      </label>
      <button class="btn btn-primary" type="submit">Sign in</button>
      <div class="divider">or</div>
      <button class="btn btn-google" type="button" data-google-login><span class="google-dot"></span>Continue with Google</button>
    </form>
  `;
}

function registerForm() {
  return `
    <form class="form-stack" data-register-form>
      <div class="form-head">
        <h2>Create your workspace</h2>
        <p>Start with your name, email address, and a password.</p>
      </div>
      <label class="field">
        <span>Full name</span>
        <input class="input" name="displayName" type="text" autocomplete="name" placeholder="Alex Carter" required />
      </label>
      <label class="field">
        <span>Email address</span>
        <input class="input" name="email" type="email" autocomplete="email" placeholder="you@company.com" required />
      </label>
      <label class="field">
        <span>Password</span>
        <input class="input" name="password" type="password" autocomplete="new-password" minlength="8" placeholder="Minimum 8 characters" required />
      </label>
      <button class="btn btn-primary" type="submit">Create account</button>
      <div class="divider">or</div>
      <button class="btn btn-google" type="button" data-google-login><span class="google-dot"></span>Continue with Google</button>
    </form>
  `;
}

function bindAuthEvents() {
  document.querySelectorAll('[data-auth-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.authMode = button.dataset.authTab;
      renderAuth();
    });
  });

  document.querySelector('[data-google-login]')?.addEventListener('click', () => {
    window.location.href = '/auth/google';
  });

  document.querySelector('[data-login-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const result = await api('/api/auth/login', {
        method: 'POST',
        body: {
          email: form.get('email'),
          password: form.get('password')
        }
      });
      state.user = result.user;
      await loadProjects();
      renderWorkspace();
    } catch (err) {
      showAlert(err.message || 'Sign-in failed.');
    }
  });

  document.querySelector('[data-register-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const result = await api('/api/auth/register', {
        method: 'POST',
        body: {
          displayName: form.get('displayName'),
          email: form.get('email'),
          password: form.get('password')
        }
      });
      state.user = result.user;
      await loadProjects();
      renderWorkspace();
    } catch (err) {
      showAlert(err.message || 'Registration failed.');
    }
  });
}

function renderWorkspace() {
  const projects = state.projects;
  const selected = projects.find((project) => project.id === state.selectedProjectId) || projects[0] || null;
  if (selected) state.selectedProjectId = selected.id;

  const totalTasks = projects.reduce((count, project) => count + project.tasks.length, 0);
  const doneTasks = projects.reduce((count, project) => count + project.tasks.filter((task) => task.status === 'done').length, 0);
  const activeProjects = projects.length;

  app.innerHTML = `
    <main class="workspace-layout">
      <aside class="sidebar">
        <div>
          <div class="brand"><span class="brand-mark"></span><span>WorkNest</span></div>
          <div class="user-card">
            <div class="avatar">${state.user.avatarUrl ? `<img src="${escapeHtml(state.user.avatarUrl)}" alt="" />` : escapeHtml(initials(state.user.displayName || state.user.email))}</div>
            <div>
              <strong>${escapeHtml(state.user.displayName)}</strong>
              <span>${escapeHtml(state.user.email)}</span>
            </div>
          </div>
          <nav class="side-nav">
            <div class="nav-pill active">Workspace</div>
            <div class="nav-pill">Projects</div>
            <div class="nav-pill">Team notes</div>
          </nav>
        </div>
        <div class="sidebar-footer">
          <button class="btn btn-soft" data-logout>Sign out</button>
        </div>
      </aside>

      <section class="workspace-main">
        <header class="topbar">
          <div>
            <span class="eyebrow">Operations dashboard</span>
            <h1>Today’s workspace</h1>
            <p>Track priorities, client work, and next actions from a single view.</p>
          </div>
        </header>

        <section class="stat-grid">
          <div class="stat-card"><span>Active projects</span><strong>${activeProjects}</strong></div>
          <div class="stat-card"><span>Total tasks</span><strong>${totalTasks}</strong></div>
          <div class="stat-card"><span>Completed</span><strong>${doneTasks}</strong></div>
        </section>

        <section class="workspace-grid">
          <div class="workspace-card">
            <div class="section-head">
              <div>
                <h2>Projects</h2>
                <p>Your recent client and internal work.</p>
              </div>
            </div>
            <div class="project-list">
              ${projects.length ? projects.map(projectCard).join('') : `<div class="empty">No projects yet. Create one from the panel on the right.</div>`}
            </div>
          </div>

          <div class="side-card">
            <div class="section-head">
              <div>
                <h2>New project</h2>
                <p>Add a focused work item.</p>
              </div>
            </div>
            <div data-alert class="alert"></div>
            ${newProjectForm()}
            <hr style="border:0;border-top:1px solid var(--line);margin:22px 0;" />
            ${selected ? taskPanel(selected) : `<div class="empty">Select or create a project to add tasks.</div>`}
          </div>
        </section>
      </section>
    </main>
  `;

  bindWorkspaceEvents();
}

function projectCard(project) {
  const done = project.tasks.filter((task) => task.status === 'done').length;
  const total = project.tasks.length;
  const selected = project.id === state.selectedProjectId;
  return `
    <article class="project-card" data-project-id="${escapeHtml(project.id)}" style="${selected ? 'border-color: rgba(34,197,94,.5);' : ''}">
      <div class="project-card-top">
        <div>
          <h3>${escapeHtml(project.title)}</h3>
          <p>${escapeHtml(project.notes || 'No project notes added yet.')}</p>
        </div>
        <span class="badge">${done}/${total} done</span>
      </div>
      <div class="meta-row">
        <span class="meta-chip">${escapeHtml(project.client || 'Internal')}</span>
        <span class="meta-chip">${escapeHtml(formatDate(project.dueDate))}</span>
      </div>
    </article>
  `;
}

function newProjectForm() {
  return `
    <form class="form-stack" data-project-form>
      <label class="field">
        <span>Project title</span>
        <input class="input" name="title" type="text" placeholder="Quarterly client rollout" required />
      </label>
      <div class="row">
        <label class="field">
          <span>Client</span>
          <input class="input" name="client" type="text" placeholder="Internal" />
        </label>
        <label class="field">
          <span>Due date</span>
          <input class="input" name="dueDate" type="date" />
        </label>
      </div>
      <label class="field">
        <span>Notes</span>
        <textarea class="textarea" name="notes" placeholder="What needs to happen next?"></textarea>
      </label>
      <button class="btn btn-primary" type="submit">Create project</button>
    </form>
  `;
}

function taskPanel(project) {
  return `
    <div class="section-head">
      <div>
        <h2>Tasks</h2>
        <p>${escapeHtml(project.title)}</p>
      </div>
    </div>
    <form class="form-stack" data-task-form data-project-id="${escapeHtml(project.id)}" style="margin-bottom:14px;">
      <label class="field">
        <span>Next task</span>
        <input class="input" name="title" type="text" placeholder="Prepare client summary" required />
      </label>
      <button class="btn btn-soft" type="submit">Add task</button>
    </form>
    <div class="task-list">
      ${project.tasks.length ? project.tasks.map((task) => taskItem(project.id, task)).join('') : `<div class="empty">No tasks yet.</div>`}
    </div>
  `;
}

function taskItem(projectId, task) {
  return `
    <button class="task-item ${task.status === 'done' ? 'done' : ''}" data-task-toggle data-project-id="${escapeHtml(projectId)}" data-task-id="${escapeHtml(task.id)}" type="button">
      <span class="check"></span>
      <span class="task-title">${escapeHtml(task.title)}</span>
    </button>
  `;
}

function bindWorkspaceEvents() {
  document.querySelector('[data-logout]')?.addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    state.user = null;
    state.projects = [];
    state.selectedProjectId = null;
    renderAuth();
  });

  document.querySelector('[data-project-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const result = await api('/api/projects', {
        method: 'POST',
        body: {
          title: form.get('title'),
          client: form.get('client'),
          dueDate: form.get('dueDate') || null,
          notes: form.get('notes')
        }
      });
      state.selectedProjectId = result.project.id;
      await loadProjects();
      renderWorkspace();
    } catch (err) {
      showAlert(err.message || 'Could not create project.');
    }
  });

  document.querySelectorAll('[data-project-id].project-card').forEach((card) => {
    card.addEventListener('click', () => {
      state.selectedProjectId = card.dataset.projectId;
      renderWorkspace();
    });
  });

  document.querySelector('[data-task-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const projectId = event.currentTarget.dataset.projectId;
    try {
      await api(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        body: { title: form.get('title') }
      });
      await loadProjects();
      renderWorkspace();
    } catch (err) {
      showAlert(err.message || 'Could not add task.');
    }
  });

  document.querySelectorAll('[data-task-toggle]').forEach((item) => {
    item.addEventListener('click', async () => {
      const project = state.projects.find((candidate) => candidate.id === item.dataset.projectId);
      const task = project?.tasks.find((candidate) => candidate.id === item.dataset.taskId);
      if (!task) return;
      await api(`/api/projects/${project.id}/tasks/${task.id}`, {
        method: 'PATCH',
        body: { status: task.status === 'done' ? 'open' : 'done' }
      });
      await loadProjects();
      renderWorkspace();
    });
  });
}

boot();
