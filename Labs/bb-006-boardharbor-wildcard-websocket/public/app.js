"use strict";

const app = document.querySelector("#app");
const toastElement = document.querySelector("#toast");
const state = {
  session: null,
  boards: [],
  selectedBoardId: null,
  socket: null,
  view: "boards",
  layout: "table",
  filter: "All",
  sort: "newest",
  query: "",
};

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(state.session?.accessToken && url.startsWith("/api/")
        ? { authorization: `Bearer ${state.session.accessToken}` }
        : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok)
    throw new Error(body?.error || `Request failed (${response.status})`);
  return body;
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ],
  );
}

function initials(name) {
  return String(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function icon(name) {
  const paths = {
    activity:
      '<path d="M4 13h3l2-7 4 12 2-7h5"/><path d="M3 3v18h18"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
    board:
      '<rect x="3" y="3" width="7" height="18" rx="2"/><rect x="14" y="3" width="7" height="11" rx="2"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    columns:
      '<rect x="3" y="4" width="7" height="16" rx="2"/><rect x="14" y="4" width="7" height="16" rx="2"/>',
    filter: '<path d="M4 5h16M7 12h10M10 19h4"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    sort: '<path d="M8 6h12M8 12h9M8 18h6"/><path d="m3 8 2-2 2 2M5 6v12"/>',
    table:
      '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>',
    timeline:
      '<path d="M5 5v14M5 8h5M5 16h9"/><circle cx="16" cy="8" r="2"/><circle cx="18" cy="16" r="2"/>',
    work: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  };
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.board}</svg>`;
}

function statusClass(status) {
  return status.toLowerCase().replaceAll(" ", "-");
}

function showToast(message) {
  toastElement.textContent = message;
  toastElement.classList.add("show");
  window.setTimeout(() => toastElement.classList.remove("show"), 2400);
}

function logo() {
  return `<a class="brand" href="/"><span class="logo-mark"><i></i><i></i><i></i></span><span>BoardHarbor</span></a>`;
}

function renderAuth(mode = "login") {
  const registering = mode === "register";
  app.innerHTML = `<div class="auth-layout"><section class="auth-story">${logo()}<div class="story-copy"><span class="kicker">WORK MANAGEMENT</span><h1>Keep projects and priorities in one place.</h1><p>Plan work, track progress, and stay current with your team.</p></div><div class="auth-feature-list"><span>Private workspaces</span><span>Live board updates</span><span>Simple status tracking</span></div></section><main class="auth-panel"><form id="auth-form" class="auth-card"><div class="auth-tabs"><button type="button" class="auth-tab ${registering ? "" : "active"}" data-auth-mode="login">Sign in</button><button type="button" class="auth-tab ${registering ? "active" : ""}" data-auth-mode="register">Create account</button></div><h2>${registering ? "Create a workspace" : "Welcome back"}</h2><p>${registering ? "Start a workspace for your team." : "Sign in to continue to BoardHarbor."}</p>${registering ? '<label>Full name<input name="name" autocomplete="name" maxlength="80" required autofocus></label><label>Workspace name<input name="organizationName" autocomplete="organization" maxlength="100" required></label>' : ""}<label>Work email<input name="email" type="email" autocomplete="email" required ${registering ? "" : "autofocus"}></label><label>Password<input name="password" type="password" minlength="8" autocomplete="${registering ? "new-password" : "current-password"}" required></label><button class="primary wide" type="submit">${registering ? "Create workspace" : "Sign in"}</button><p id="auth-error" class="form-error" role="alert"></p></form></main></div>`;
  document
    .querySelectorAll("[data-auth-mode]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        renderAuth(button.dataset.authMode),
      ),
    );
  document
    .querySelector("#auth-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = event.currentTarget.querySelector("button[type=submit]");
      submit.disabled = true;
      try {
        const form = Object.fromEntries(new FormData(event.currentTarget));
        state.session = (
          await api(`/api/auth/${registering ? "register" : "login"}`, {
            method: "POST",
            body: JSON.stringify(form),
          })
        ).user;
        await loadWorkspace();
      } catch (error) {
        document.querySelector("#auth-error").textContent = error.message;
        submit.disabled = false;
      }
    });
}

function selectedBoard() {
  return (
    state.boards.find((board) => board.id === state.selectedBoardId) ||
    state.boards[0] ||
    null
  );
}

function renderWorkspace() {
  const user = state.session;
  const board = selectedBoard();
  const contextName =
    state.view === "my-work"
      ? "My work"
      : state.view === "activity"
        ? "Activity"
        : board?.name || "Boards";
  const content =
    state.view === "my-work"
      ? renderMyWork()
      : state.view === "activity"
        ? renderActivity()
        : board
          ? renderBoard(board)
          : renderEmpty();
  app.innerHTML = `<div class="workspace"><aside class="sidebar">${logo()}<button class="org-summary" type="button"><span class="org-avatar">${escapeHtml(user.org[0])}</span><div><strong>${escapeHtml(user.org)}</strong><small>Free workspace · ${escapeHtml(user.role.toLowerCase())}</small></div>${icon("chevron")}</button><nav><p>Workspace</p><button class="nav-item ${state.view === "boards" ? "active" : ""}" data-view="boards">${icon("board")}<span>Boards</span></button><button class="nav-item ${state.view === "my-work" ? "active" : ""}" data-view="my-work">${icon("work")}<span>My work</span></button><button class="nav-item ${state.view === "activity" ? "active" : ""}" data-view="activity">${icon("activity")}<span>Activity</span></button><p>My boards <b>${state.boards.length}</b></p>${state.boards.map((item) => `<button class="board-link ${state.view === "boards" && item.id === board?.id ? "selected" : ""}" data-board-id="${item.id}"><i style="background:${escapeHtml(item.color)}"></i><span>${escapeHtml(item.name)}</span><small>${item.items.length}</small></button>`).join("")}</nav><div class="sidebar-plan"><span>Workspace usage</span><strong>${state.boards.length} of 3 boards</strong><i><b style="width:${Math.min(100, (state.boards.length / 3) * 100)}%"></b></i></div><div class="profile"><span class="profile-avatar">${escapeHtml(initials(user.name))}</span><div><strong>${escapeHtml(user.name)}</strong><small>${escapeHtml(user.email)}</small></div><button id="logout" title="Sign out">Sign out</button></div></aside><main class="content"><header class="topbar"><div class="breadcrumb"><span>${escapeHtml(user.org)}</span>${icon("chevron")}<strong>${escapeHtml(contextName)}</strong></div><form id="search-form" class="search">${icon("search")}<input id="global-search" value="${escapeHtml(state.query)}" placeholder="Search tasks, boards, and people…" aria-label="Find an item">${state.query ? '<button id="clear-search" type="button">Clear</button>' : '<kbd>⌘ K</kbd>'}</form><div class="top-actions"><button id="notifications" class="icon-button" title="Notifications">${icon("bell")}<i></i></button></div></header>${content}</main></div>`;
  bindWorkspace();
  if (board) connectRealtime(board.id);
}

function filteredItems(board) {
  let items = [...board.items];
  if (state.filter !== "All")
    items = items.filter((item) => item.status === state.filter);
  if (state.query)
    items = items.filter((item) =>
      item.title.toLowerCase().includes(state.query.toLowerCase()),
    );
  items.sort(
    state.sort === "title"
      ? (a, b) => a.title.localeCompare(b.title)
      : (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  );
  return items;
}

function renderBoard(board) {
  const items = filteredItems(board);
  const userById = Object.fromEntries([[state.session.id, state.session.name]]);
  const statusCounts = Object.fromEntries(
    ["To do", "In progress", "Review", "Done"].map((status) => [
      status,
      board.items.filter((item) => item.status === status).length,
    ]),
  );
  const body =
    state.layout === "board"
      ? renderKanban(items, userById)
      : state.layout === "timeline"
        ? renderTimeline(items)
        : renderTable(items, userById);
  return `<section class="board-page"><header class="page-header"><div class="title-row"><span class="board-icon" style="--board-color:${escapeHtml(board.color)}">${escapeHtml(board.name[0])}</span><div><div class="title-meta"><span>${icon("lock")} Private board</span><b>BH-${board.id}</b></div><h1>${escapeHtml(board.name)}</h1><p>${escapeHtml(board.description)}</p></div></div><div class="page-actions"><span id="live-state" class="live-state"><i></i>Connecting</span><button id="share-board" class="secondary-action">Share</button>${["EDITOR", "OWNER"].includes(state.session.role) ? `<button id="new-item" class="primary">${icon("plus")}New item</button>` : ""}</div></header><section class="metrics-grid"><article><span>Total tasks</span><strong>${board.items.length}</strong><small>Across this board</small></article><article><span>In progress</span><strong>${statusCounts["In progress"]}</strong><small>${board.items.length ? Math.round((statusCounts["In progress"] / board.items.length) * 100) : 0}% of all work</small></article><article><span>In review</span><strong>${statusCounts.Review}</strong><small>Awaiting approval</small></article><article><span>Completed</span><strong>${statusCounts.Done}</strong><small>${statusCounts["To do"]} still to do</small></article></section><section class="work-card"><div class="board-toolbar"><div class="view-tabs"><button class="tool ${state.layout === "table" ? "active" : ""}" data-layout="table">${icon("table")}Table</button><button class="tool ${state.layout === "board" ? "active" : ""}" data-layout="board">${icon("columns")}Board</button><button class="tool ${state.layout === "timeline" ? "active" : ""}" data-layout="timeline">${icon("timeline")}Timeline</button></div><div class="toolbar-actions"><button id="filter" class="tool ${state.filter !== "All" ? "active-control" : ""}">${icon("filter")}Filter${state.filter !== "All" ? `: ${escapeHtml(state.filter)}` : ""}</button><button id="sort" class="tool">${icon("sort")}Sort: ${state.sort === "newest" ? "Newest" : "Title"}</button><button id="board-details" class="tool details-button">•••</button></div></div>${body}<footer class="board-footer"><span>Showing ${items.length} of ${board.items.length} tasks</span><span><i></i>Synced just now</span></footer></section></section>`;
}

function renderTable(items, userById) {
  return `<section class="table-card"><table><thead><tr><th>Item</th><th>Status</th><th>Owner</th><th>Created</th></tr></thead><tbody>${items.length ? items.map((item) => `<tr><td>${renderItemControl(item, state.selectedBoardId)}</td><td><span class="status ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td><td><span class="mini-avatar">${escapeHtml(initials(userById[item.createdById] || "Team member"))}</span></td><td>${new Date(item.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</td></tr>`).join("") : '<tr><td colspan="4" class="empty-row">No items match this view</td></tr>'}</tbody></table></section>`;
}

function renderKanban(items, userById) {
  const statuses = ["To do", "In progress", "Review", "Done"];
  return `<section class="kanban">${statuses
    .map((status) => {
      const columnItems = items.filter((item) => item.status === status);
      return `<div class="kanban-column"><header><span class="status ${statusClass(status)}">${status}</span><b>${columnItems.length}</b></header>${columnItems.map((item) => `<article>${renderItemControl(item, state.selectedBoardId)}<span class="mini-avatar">${escapeHtml(initials(userById[item.createdById] || "Team member"))}</span></article>`).join("") || '<p class="column-empty">No items</p>'}</div>`;
    })
    .join("")}</section>`;
}

function renderTimeline(items) {
  return `<section class="timeline">${items.length ? items.map((item) => `<article><time>${new Date(item.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</time><i></i><div>${renderItemControl(item, state.selectedBoardId)}<span class="status ${statusClass(item.status)}">${escapeHtml(item.status)}</span></div></article>`).join("") : '<p class="empty-row">No items match this view</p>'}</section>`;
}

function renderItemControl(item, boardId) {
  const content = `<strong>${escapeHtml(item.title)}</strong><small>BH-${item.id}</small>`;
  return ["EDITOR", "OWNER"].includes(state.session.role)
    ? `<button class="item-edit" data-edit-item="${item.id}" data-edit-board="${boardId}" title="Edit item">${content}</button>`
    : `<span class="item-readonly">${content}</span>`;
}

function allItems() {
  return state.boards.flatMap((board) =>
    board.items.map((item) => ({
      ...item,
      boardId: board.id,
      boardName: board.name,
    })),
  );
}

function queryItems(items) {
  return state.query
    ? items.filter((item) =>
        item.title.toLowerCase().includes(state.query.toLowerCase()),
      )
    : items;
}

function renderMyWork() {
  const items = queryItems(
    allItems().filter((item) => item.createdById === state.session.id),
  );
  const dueSoon = items.filter((item) => item.status !== "Done").length;
  const completed = items.filter((item) => item.status === "Done").length;
  return `<section class="secondary-page"><header class="secondary-header"><div><span class="page-kicker">PERSONAL WORKSPACE</span><h1>My work</h1><p>Everything assigned to you across ${escapeHtml(state.session.org)}.</p></div><span class="date-chip">${new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</span></header><section class="metrics-grid personal-metrics"><article><span>Assigned to me</span><strong>${items.length}</strong><small>Across ${state.boards.length} board${state.boards.length === 1 ? "" : "s"}</small></article><article><span>Open work</span><strong>${dueSoon}</strong><small>Needs your attention</small></article><article><span>Completed</span><strong>${completed}</strong><small>${items.length ? Math.round((completed / items.length) * 100) : 0}% completion rate</small></article></section><section class="work-card personal-work"><header class="card-heading"><div><h2>Assigned tasks</h2><p>Your most recent work items</p></div><span>${items.length} total</span></header><section class="table-card"><table><thead><tr><th>Task</th><th>Board</th><th>Status</th><th>Created</th></tr></thead><tbody>${items.length ? items.map((item) => `<tr><td>${renderItemControl(item, item.boardId)}</td><td><span class="board-reference"><i></i>${escapeHtml(item.boardName)}</span></td><td><span class="status ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td><td>${new Date(item.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</td></tr>`).join("") : '<tr><td colspan="4" class="empty-row">No matching work</td></tr>'}</tbody></table></section></section></section>`;
}

function renderActivity() {
  const items = queryItems(allItems()).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  );
  return `<section class="secondary-page"><header class="secondary-header"><div><span class="page-kicker">WORKSPACE FEED</span><h1>Recent activity</h1><p>Changes and updates across ${escapeHtml(state.session.org)}.</p></div><span class="live-state online"><i></i>Live</span></header><section class="activity-layout"><div class="activity-main"><header class="card-heading"><div><h2>All activity</h2><p>Latest first</p></div><button id="mark-read" class="quiet-action" type="button">Mark all read</button></header><div class="activity-list">${items.length ? items.map((item) => `<article><span class="activity-icon">${icon("plus")}</span><span class="profile-avatar">${escapeHtml(initials(item.createdById === state.session.id ? state.session.name : "Team member"))}</span><div><p><strong>${escapeHtml(item.createdById === state.session.id ? state.session.name : "A team member")}</strong> created <b>${escapeHtml(item.title)}</b></p><small>${escapeHtml(item.boardName)} · ${new Date(item.createdAt).toLocaleString()}</small></div><time>${new Date(item.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time></article>`).join("") : '<p class="empty-row">No matching activity</p>'}</div></div><aside class="activity-summary"><span>This week</span><strong>${items.length}</strong><p>workspace updates</p><i><b style="width:${Math.min(100, items.length * 18)}%"></b></i><small>Activity is visible to members of this workspace.</small></aside></section></section>`;
}

function renderEmpty() {
  return '<section class="empty-page"><h1>No boards yet</h1><p>Your organization does not have any boards.</p></section>';
}

function bindWorkspace() {
  document.querySelector(".org-summary")?.addEventListener("click", () =>
    openInfoModal(
      state.session.org,
      "You are working inside this private organization workspace.",
      `<dl class="details"><dt>Organization ID</dt><dd>${state.session.orgId}</dd><dt>Your role</dt><dd>${escapeHtml(state.session.role.toLowerCase())}</dd><dt>Plan</dt><dd>Free</dd></dl>`,
    ),
  );
  document.querySelectorAll("[data-view]").forEach((button) =>
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      renderWorkspace();
    }),
  );
  document.querySelectorAll("[data-board-id]").forEach((button) =>
    button.addEventListener("click", () => {
      state.selectedBoardId = Number(button.dataset.boardId);
      state.view = "boards";
      renderWorkspace();
    }),
  );
  document.querySelectorAll("[data-layout]").forEach((button) =>
    button.addEventListener("click", () => {
      state.layout = button.dataset.layout;
      renderWorkspace();
    }),
  );
  document
    .querySelector("#new-item")
    ?.addEventListener("click", openNewItemModal);
  document
    .querySelectorAll("[data-edit-item]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        openEditItemModal(
          Number(button.dataset.editBoard),
          Number(button.dataset.editItem),
        ),
      ),
    );
  document.querySelector("#filter")?.addEventListener("click", () => {
    const filters = ["All", "To do", "In progress", "Review", "Done"];
    state.filter =
      filters[(filters.indexOf(state.filter) + 1) % filters.length];
    renderWorkspace();
  });
  document.querySelector("#sort")?.addEventListener("click", () => {
    state.sort = state.sort === "newest" ? "title" : "newest";
    renderWorkspace();
  });
  document
    .querySelector("#board-details")
    ?.addEventListener("click", openBoardDetails);
  document.querySelector("#share-board")?.addEventListener("click", () =>
    openInfoModal(
      "Share board",
      "Invite workspace members to collaborate on this private board.",
      '<div class="share-preview"><span>Private</span><p>Only members of this workspace can be invited.</p></div>',
    ),
  );
  document
    .querySelector("#notifications")
    .addEventListener("click", () =>
      openInfoModal(
        "Notifications",
        "You are all caught up. New board activity will appear here.",
      ),
    );
  document
    .querySelector("#mark-read")
    ?.addEventListener("click", () => showToast("Activity marked as read"));
  document.querySelector("#search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    state.query = document.querySelector("#global-search").value.trim();
    renderWorkspace();
  });
  document.querySelector("#clear-search")?.addEventListener("click", () => {
    state.query = "";
    renderWorkspace();
  });
  document.querySelector("#logout").addEventListener("click", async () => {
    closeRealtime();
    await api("/api/auth/logout", { method: "POST" });
    state.session = null;
    renderAuth();
  });
}

function openInfoModal(title, message, details = "") {
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML = `<section class="modal info-modal"><header><h2>${escapeHtml(title)}</h2><button type="button" class="modal-close">Close</button></header><p>${escapeHtml(message)}</p>${details}<footer><button type="button" class="primary modal-done">Done</button></footer></section>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector(".modal-close").addEventListener("click", close);
  overlay.querySelector(".modal-done").addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
}

function openBoardDetails() {
  const board = selectedBoard();
  openInfoModal(
    "Board details",
    `${board.name} contains ${board.items.length} items.`,
    `<dl class="details"><dt>Board ID</dt><dd>${board.id}</dd><dt>Organization</dt><dd>${escapeHtml(state.session.org)}</dd><dt>Access</dt><dd>Private</dd></dl>`,
  );
}

function openEditItemModal(boardId, itemId) {
  const board = state.boards.find((candidate) => candidate.id === boardId);
  const item = board?.items.find((candidate) => candidate.id === itemId);
  if (!board || !item) return showToast("Item is no longer available");
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML = `<form class="modal"><header><h2>Edit item</h2><button type="button" class="modal-close">Close</button></header><label>Item name<input name="title" maxlength="120" value="${escapeHtml(item.title)}" required autofocus></label><label>Status<select name="status">${["To do", "In progress", "Review", "Done"].map((status) => `<option ${item.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></label><p class="form-error"></p><footer><button type="button" class="cancel">Cancel</button><button type="submit" class="primary">Save changes</button></footer></form>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector(".modal-close").addEventListener("click", close);
  overlay.querySelector(".cancel").addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  overlay.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/boards/${boardId}/items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify(
          Object.fromEntries(new FormData(event.currentTarget)),
        ),
      });
      close();
      await refreshBoards();
      renderWorkspace();
      showToast("Item updated");
    } catch (error) {
      overlay.querySelector(".form-error").textContent = error.message;
    }
  });
}

function openNewItemModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML = `<form class="modal"><header><h2>New item</h2><button type="button" class="modal-close">Close</button></header><label>Item name<input name="title" maxlength="120" required autofocus></label><label>Status<select name="status"><option>To do</option><option>In progress</option><option>Review</option><option>Done</option></select></label><p class="form-error"></p><footer><button type="button" class="cancel">Cancel</button><button type="submit" class="primary">Add item</button></footer></form>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector(".modal-close").addEventListener("click", close);
  overlay.querySelector(".cancel").addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  overlay.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/boards/${state.selectedBoardId}/items`, {
        method: "POST",
        body: JSON.stringify(
          Object.fromEntries(new FormData(event.currentTarget)),
        ),
      });
      close();
      await refreshBoards();
      renderWorkspace();
      showToast("Item added");
    } catch (error) {
      overlay.querySelector(".form-error").textContent = error.message;
    }
  });
}

function stompFrame(command, headers = {}) {
  return `${command}\n${Object.entries(headers)
    .map(([key, value]) => `${key}:${value}`)
    .join("\n")}\n\n\u0000`;
}

function closeRealtime() {
  if (state.socket) state.socket.close();
  state.socket = null;
}

function connectRealtime(boardId) {
  closeRealtime();
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const sessionId = Math.random().toString(36).slice(2, 10);
  const socket = new WebSocket(
    `${protocol}://${location.host}/websocket/639/${sessionId}/websocket`,
  );
  state.socket = socket;
  socket.addEventListener("message", async ({ data }) => {
    if (data === "o")
      socket.send(
        JSON.stringify([
          stompFrame("CONNECT", {
            "accept-version": "1.2",
            Authorization: `Bearer ${state.session.accessToken}`,
            "heart-beat": "0,0",
          }),
        ]),
      );
    else if (data.includes("CONNECTED")) {
      const liveState = document.querySelector("#live-state");
      liveState?.classList.add("online");
      if (liveState) liveState.lastChild.textContent = " Live";
      socket.send(
        JSON.stringify([
          stompFrame("SUBSCRIBE", {
            id: "board-updates",
            destination: `/topic/boards/${boardId}`,
          }),
        ]),
      );
    } else if (data.includes("MESSAGE") && state.selectedBoardId === boardId) {
      await refreshBoards();
      renderWorkspace();
      showToast("Board updated");
    }
  });
}

async function refreshBoards() {
  state.boards = (await api("/api/boards")).boards;
  if (!state.selectedBoardId && state.boards.length)
    state.selectedBoardId = state.boards[0].id;
}

async function loadWorkspace() {
  await refreshBoards();
  renderWorkspace();
}

async function boot() {
  try {
    state.session = (await api("/api/session")).user;
    await loadWorkspace();
  } catch {
    renderAuth();
  }
}

boot();
