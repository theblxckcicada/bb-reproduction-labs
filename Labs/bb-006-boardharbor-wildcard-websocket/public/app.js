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

function statusClass(status) {
  return status.toLowerCase().replaceAll(" ", "-");
}

function showToast(message) {
  toastElement.textContent = message;
  toastElement.classList.add("show");
  window.setTimeout(() => toastElement.classList.remove("show"), 2400);
}

function logo() {
  return '<a class="brand" href="/"><span class="logo-mark">B</span><span>BoardHarbor</span></a>';
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
  const content =
    state.view === "my-work"
      ? renderMyWork()
      : state.view === "activity"
        ? renderActivity()
        : board
          ? renderBoard(board)
          : renderEmpty();
  app.innerHTML = `<div class="workspace"><aside class="sidebar">${logo()}<div class="org-summary"><span class="org-avatar">${escapeHtml(user.org[0])}</span><div><strong>${escapeHtml(user.org)}</strong><small>${escapeHtml(user.role.toLowerCase())}</small></div></div><nav><p>Workspace</p><button class="nav-item ${state.view === "boards" ? "active" : ""}" data-view="boards"><span>▦</span>Boards</button><button class="nav-item ${state.view === "my-work" ? "active" : ""}" data-view="my-work"><span>◷</span>My work</button><button class="nav-item ${state.view === "activity" ? "active" : ""}" data-view="activity"><span>◉</span>Activity</button><p>Boards</p>${state.boards.map((item) => `<button class="board-link ${state.view === "boards" && item.id === board?.id ? "selected" : ""}" data-board-id="${item.id}"><i style="background:${escapeHtml(item.color)}"></i>${escapeHtml(item.name)}</button>`).join("")}</nav><div class="profile"><span class="profile-avatar">${escapeHtml(initials(user.name))}</span><div><strong>${escapeHtml(user.name)}</strong><small>${escapeHtml(user.email)}</small></div><button id="logout" title="Sign out">Exit</button></div></aside><main class="content"><header class="topbar"><form id="search-form" class="search"><span>Search</span><input id="global-search" value="${escapeHtml(state.query)}" placeholder="Find an item" aria-label="Find an item">${state.query ? '<button id="clear-search" type="button">Clear</button>' : '<button type="submit">Go</button>'}</form><div class="top-actions"><button id="help" class="text-button">Help</button><button id="notifications" class="text-button">Notifications</button></div></header>${content}</main></div>`;
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
  const body =
    state.layout === "board"
      ? renderKanban(items, userById)
      : state.layout === "timeline"
        ? renderTimeline(items)
        : renderTable(items, userById);
  return `<section class="board-page"><header class="page-header"><div class="title-row"><span class="board-icon" style="background:${escapeHtml(board.color)}">${escapeHtml(board.name[0])}</span><div><h1>${escapeHtml(board.name)}</h1><p>${escapeHtml(board.description)}</p></div></div><div class="page-actions"><span id="live-state" class="live-state"><i></i>Connecting</span>${["EDITOR", "OWNER"].includes(state.session.role) ? '<button id="new-item" class="primary">New item</button>' : ""}</div></header><div class="board-toolbar"><div><button class="tool ${state.layout === "table" ? "active" : ""}" data-layout="table">Table</button><button class="tool ${state.layout === "board" ? "active" : ""}" data-layout="board">Board</button><button class="tool ${state.layout === "timeline" ? "active" : ""}" data-layout="timeline">Timeline</button></div><div><button id="filter" class="tool ${state.filter !== "All" ? "active-control" : ""}">Filter: ${escapeHtml(state.filter)}</button><button id="sort" class="tool">Sort: ${state.sort === "newest" ? "Newest" : "Title"}</button><button id="board-details" class="tool">Details</button></div></div>${body}<footer class="board-footer"><span>${items.length} of ${board.items.length} items</span><span>Updated just now</span></footer></section>`;
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
  return `<section class="secondary-page"><h1>My work</h1><p>Items you created across ${escapeHtml(state.session.org)}.</p><div class="summary-card"><b>${items.length}</b><span>Items</span></div><section class="table-card"><table><thead><tr><th>Item</th><th>Board</th><th>Status</th><th>Created</th></tr></thead><tbody>${items.length ? items.map((item) => `<tr><td>${renderItemControl(item, item.boardId)}</td><td>${escapeHtml(item.boardName)}</td><td><span class="status ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td><td>${new Date(item.createdAt).toLocaleDateString()}</td></tr>`).join("") : '<tr><td colspan="4" class="empty-row">No matching work</td></tr>'}</tbody></table></section></section>`;
}

function renderActivity() {
  const items = queryItems(allItems()).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  );
  return `<section class="secondary-page"><h1>Activity</h1><p>Recent changes in ${escapeHtml(state.session.org)}.</p><div class="activity-list">${items.length ? items.map((item) => `<article><span class="profile-avatar">${escapeHtml(initials(item.createdById === state.session.id ? state.session.name : "Team member"))}</span><div><strong>${escapeHtml(item.createdById === state.session.id ? state.session.name : "A team member")}</strong> added <b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.boardName)} - ${new Date(item.createdAt).toLocaleString()}</small></div></article>`).join("") : '<p class="empty-row">No matching activity</p>'}</div></section>`;
}

function renderEmpty() {
  return '<section class="empty-page"><h1>No boards yet</h1><p>Your organization does not have any boards.</p></section>';
}

function bindWorkspace() {
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
  document
    .querySelector("#help")
    .addEventListener("click", () =>
      openInfoModal(
        "Help",
        "Create items, switch views, filter by status, and search for work in your organization.",
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
