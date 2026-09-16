'use strict';

const app = document.querySelector('#app');
const toastElement = document.querySelector('#toast');
const state = { session: null, groups: [], participants: [], selectedGroupId: null, groupParticipants: [], links: [] };

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`);
  return body;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function toast(message) {
  toastElement.textContent = message;
  toastElement.classList.add('show');
  window.setTimeout(() => toastElement.classList.remove('show'), 2800);
}

function logo() {
  return '<a class="brand" href="/"><span class="brand-mark">C</span><span>Campus Relay<small>Classroom workspace</small></span></a>';
}

function renderAuth(mode = 'login') {
  const registering = mode === 'register';
  app.innerHTML = `<div class="auth-shell"><section class="auth-story">${logo()}<div><p class="eyebrow">ONE PLACE FOR EVERY CLASS</p><h1>Bring your classroom<br>into focus.</h1><p>Organize classes, manage student rosters, and provide simple student access from one calm workspace.</p><div class="story-card"><span>01</span><div><strong>Create a class</strong><small>Set up a private space for each subject or homeroom.</small></div></div><div class="story-card"><span>02</span><div><strong>Add your students</strong><small>Keep each class roster current and ready to learn.</small></div></div></div></section><main class="auth-panel"><div class="auth-card"><p class="eyebrow">${registering ? 'GET STARTED' : 'WELCOME BACK'}</p><h2>${registering ? 'Create your teacher account' : 'Sign in to your school workspace'}</h2><form id="auth-form">${registering ? '<label>Full name<input name="name" autocomplete="name" required></label>' : ''}<label>School email address<input name="email" type="email" autocomplete="email" required></label><label>Password<input name="password" type="password" minlength="8" autocomplete="${registering ? 'new-password' : 'current-password'}" required></label><button class="primary" type="submit">${registering ? 'Create teacher account' : 'Sign in'}</button></form><p class="switch">${registering ? 'Already have an account?' : 'New to Campus Relay?'} <button class="link" id="switch-auth">${registering ? 'Sign in' : 'Create one'}</button></p><p id="form-error" class="form-error"></p></div></main></div>`;
  document.querySelector('#switch-auth').addEventListener('click', () => renderAuth(registering ? 'login' : 'register'));
  document.querySelector('#auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      state.session = await api(`/api/auth/${registering ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify(data) });
      await loadWorkspace();
    } catch (error) { document.querySelector('#form-error').textContent = error.message; }
  });
}

function shell(content, active = 'groups') {
  const user = state.session.user;
  return `<div class="workspace"><aside>${logo()}<nav><button data-view="groups" class="${active === 'groups' ? 'active' : ''}"><span>▦</span> Classes</button><button data-view="people" class="${active === 'people' ? 'active' : ''}"><span>◉</span> Students</button></nav><div class="profile"><div class="avatar">${escapeHtml(user.name.charAt(0).toUpperCase())}</div><div><strong>${escapeHtml(user.name)}</strong><small>${escapeHtml(user.email)}</small></div><button id="logout" title="Sign out">↗</button></div></aside><main class="content">${content}</main></div>`;
}

function bindShell() {
  document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => button.dataset.view === 'groups' ? renderGroups() : renderParticipants()));
  document.querySelector('#logout').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); state.session = null; renderAuth(); });
}

function renderGroups() {
  app.innerHTML = shell(`<header class="page-head"><div><p class="eyebrow">TEACHER WORKSPACE</p><h1>Your classes</h1><p>Create a class, build its roster, and share student login links.</p></div><button class="primary" id="new-group">+ New class</button></header><section class="cards">${state.groups.length ? state.groups.map((group) => `<button class="group-card" data-group="${escapeHtml(group.id)}"><div class="group-icon">${escapeHtml(group.name.charAt(0).toUpperCase())}</div><div><h3>${escapeHtml(group.name)}</h3><p>${group.participantCount} student${group.participantCount === 1 ? '' : 's'}</p><code>${escapeHtml(group.id)}</code></div><span>→</span></button>`).join('') : '<div class="empty"><div>▦</div><h3>No classes yet</h3><p>Create your first class to start building a student roster.</p></div>'}</section>`, 'groups');
  bindShell();
  document.querySelector('#new-group').addEventListener('click', () => showModal('Create a class', '<label>Class name<input name="name" maxlength="80" placeholder="e.g. Year 7 Mathematics" required></label>', async (data) => { await api('/api/classes', { method: 'POST', body: JSON.stringify(data) }); await loadWorkspace(); toast('Class created'); }));
  document.querySelectorAll('[data-group]').forEach((card) => card.addEventListener('click', async () => { state.selectedGroupId = card.dataset.group; await loadGroup(); renderGroup(); }));
}

function renderParticipants() {
  app.innerHTML = shell(`<header class="page-head"><div><p class="eyebrow">SCHOOL DIRECTORY</p><h1>Students</h1><p>Student profiles created in your teacher workspace.</p></div><button class="primary" id="new-participant">+ Add student</button></header><section class="table-card">${state.participants.length ? `<table><thead><tr><th>Name</th><th>Student ID</th><th>Created</th></tr></thead><tbody>${state.participants.map((participant) => `<tr><td><strong>${escapeHtml(participant.firstName)} ${escapeHtml(participant.lastName)}</strong></td><td><code>${escapeHtml(participant.id)}</code><button class="copy" data-copy="${escapeHtml(participant.id)}">Copy</button></td><td>${new Date(participant.createdAt).toLocaleDateString()}</td></tr>`).join('')}</tbody></table>` : '<div class="empty"><div>◉</div><h3>No students yet</h3><p>Add a student profile, then place it into one of your classes.</p></div>'}</section>`, 'people');
  bindShell();
  document.querySelector('#new-participant').addEventListener('click', () => showModal('Add student', '<div class="field-row"><label>First name<input name="firstName" required></label><label>Last name<input name="lastName" required></label></div>', async (data) => { await api('/api/students', { method: 'POST', body: JSON.stringify(data) }); await loadWorkspace('people'); toast('Student added'); }));
  bindCopies();
}

function renderGroup() {
  const group = state.groups.find((item) => item.id === state.selectedGroupId);
  if (!group) return renderGroups();
  const available = state.participants.filter((participant) => !state.groupParticipants.some((item) => item.id === participant.id));
  app.innerHTML = shell(`<button class="back" id="back">← All classes</button><header class="page-head compact"><div><p class="eyebrow">CLASSROOM</p><h1>${escapeHtml(group.name)}</h1><p><code>${escapeHtml(group.id)}</code> · ${state.groupParticipants.length} on roster</p></div><div class="actions"><button id="access-links">Student login links</button><button class="primary" id="add-to-roster" ${available.length ? '' : 'disabled'}>+ Add student</button></div></header><section class="table-card"><div class="section-title"><div><h2>Class roster</h2><p>Students currently enrolled in this class.</p></div></div>${state.groupParticipants.length ? `<table><thead><tr><th>Student</th><th>Reference</th></tr></thead><tbody>${state.groupParticipants.map((participant) => `<tr><td><strong>${escapeHtml(participant.firstName)} ${escapeHtml(participant.lastName)}</strong></td><td><code>${escapeHtml(participant.id)}</code><button class="copy" data-copy="${escapeHtml(participant.id)}">Copy</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty small"><h3>This class roster is empty</h3><p>Add one of your student profiles to get started.</p></div>'}</section>${state.links.length ? `<section class="table-card links"><div class="section-title"><div><h2>Student login links</h2><p>Each link expires after 30 minutes.</p></div></div>${state.links.map((link) => `<div class="link-row"><div><strong>${escapeHtml(link.firstName)} ${escapeHtml(link.lastName)}</strong><small>${escapeHtml(link.id)}</small></div><input readonly value="${escapeHtml(link.accessInstructionsLink)}"><button class="copy" data-copy="${escapeHtml(link.accessInstructionsLink)}">Copy link</button></div>`).join('')}</section>` : ''}`, 'groups');
  bindShell(); bindCopies();
  document.querySelector('#back').addEventListener('click', renderGroups);
  document.querySelector('#add-to-roster').addEventListener('click', () => showModal('Add student to class', `<label>Student<select name="participantId">${available.map((participant) => `<option value="${escapeHtml(participant.id)}">${escapeHtml(participant.firstName)} ${escapeHtml(participant.lastName)}</option>`).join('')}</select></label>`, async (data) => { await api(`/api/students/${encodeURIComponent(data.participantId)}/enroll`, { method: 'POST', body: JSON.stringify({ classIds: [group.id] }) }); await loadGroup(); await refreshWorkspaceData(); renderGroup(); toast('Class roster updated'); }));
  document.querySelector('#access-links').addEventListener('click', async () => { try { state.links = await api(`/api/classLoginLinks/${encodeURIComponent(group.id)}`); renderGroup(); } catch (error) { toast(error.message); } });
}

function renderParticipantHome() {
  const participant = state.session.student;
  app.innerHTML = `<div class="participant-home"><header>${logo()}<button id="participant-logout">Sign out</button></header><main><div class="welcome-orb">${escapeHtml(participant.firstName.charAt(0))}</div><p class="eyebrow">STUDENT PORTAL</p><h1>Welcome, ${escapeHtml(participant.firstName)}.</h1><p>Your student space is ready. Updates from your classes will appear here.</p><section><div><span>✓</span><strong>You're signed in</strong><small>Student reference: ${escapeHtml(participant.id)}</small></div><div><span>○</span><strong>No new class updates</strong><small>Check back after your next lesson.</small></div></section></main></div>`;
  document.querySelector('#participant-logout').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); state.session = null; renderAuth(); });
}

async function renderAccessInstructions(token) {
  app.innerHTML = `<div class="participant-home"><header>${logo()}</header><main><div class="welcome-orb">↗</div><p class="eyebrow">STUDENT ACCESS</p><h1>Your class is ready.</h1><p>This private link signs a student into the Campus Relay portal.</p><button class="primary" id="continue-to-portal">Continue to student portal</button><p id="access-error" class="form-error"></p></main></div>`;
  document.querySelector('#continue-to-portal').addEventListener('click', async () => {
    try {
      const result = await api(`/api/studentPortalLogin/${encodeURIComponent(token)}`);
      window.location.assign(result.url);
    } catch (error) { document.querySelector('#access-error').textContent = error.message; }
  });
}

function showModal(title, fields, onSubmit) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<form class="modal"><div><h2>${escapeHtml(title)}</h2><button type="button" class="close">×</button></div>${fields}<p class="form-error"></p><footer><button type="button" class="cancel">Cancel</button><button class="primary" type="submit">Save</button></footer></form>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.close').addEventListener('click', close); overlay.querySelector('.cancel').addEventListener('click', close);
  overlay.querySelector('form').addEventListener('submit', async (event) => { event.preventDefault(); try { await onSubmit(Object.fromEntries(new FormData(event.currentTarget))); close(); } catch (error) { overlay.querySelector('.form-error').textContent = error.message; } });
}

function bindCopies() {
  document.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', async (event) => { event.stopPropagation(); await navigator.clipboard.writeText(button.dataset.copy); toast('Copied to clipboard'); }));
}

async function refreshWorkspaceData() {
  [state.groups, state.participants] = await Promise.all([api('/api/classes').then((body) => body.classes), api('/api/students').then((body) => body.students)]);
}

async function loadGroup() {
  state.groupParticipants = (await api(`/api/classes/${encodeURIComponent(state.selectedGroupId)}/students`)).students;
  state.links = [];
}

async function loadWorkspace(view = 'groups') {
  await refreshWorkspaceData();
  if (view === 'people') renderParticipants(); else renderGroups();
}

async function boot() {
  const accessMatch = window.location.pathname.match(/^\/access\/([^/]+)$/);
  if (accessMatch) return renderAccessInstructions(decodeURIComponent(accessMatch[1]));
  try {
    state.session = await api('/api/session');
    if (state.session.type === 'student') renderParticipantHome(); else await loadWorkspace();
  } catch { renderAuth(); }
}

boot();
