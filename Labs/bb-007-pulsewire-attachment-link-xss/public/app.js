"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  config: null,
  session: null,
  profile: null,
  channels: [],
  channelId: "ch_general",
  view: "channel",
  pollTimer: null,
  authMode: "login",
};

/** Create an element with optional class and text. */
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Show a temporary status message. */
function toast(message, kind = "info") {
  const node = element("div", `toast ${kind === "error" ? "error" : ""}`, message);
  $("#toast-region").append(node);
  setTimeout(() => node.remove(), 4200);
}

/** Send an API request using the active access token. */
async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (state.session?.accessToken) headers.set("AuthToken", state.session.accessToken);
  const response = await fetch(path, { ...options, headers });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(body?.message || `Request failed (${response.status})`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

/** Persist a token bundle under the same localStorage pattern used by the sink. */
function saveSession(session) {
  state.session = session;
  localStorage.setItem(`pulsewire_session_${session.workspaceId}`, JSON.stringify(session));
}

/** Find an existing workspace session. */
function restoreSession() {
  const key = Object.keys(localStorage).find((candidate) => candidate.startsWith("pulsewire_session_"));
  if (!key) return null;
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

/** Clear the active browser session. */
function clearSession() {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("pulsewire_session_")) localStorage.removeItem(key);
  }
  state.session = null;
  state.profile = null;
}

/** Format a message timestamp. */
function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

/** Determine whether the vulnerable client considers a value a meeting URL. */
function isMeetingLinkVulnerable(value) {
  return /(?:https:\/\/calls.pulsewire.test|https:\/\/meet.pulsewire.test)\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(value);
}

/** Apply the remediated, anchored meeting URL check. */
function isMeetingLinkFixed(value) {
  return /^https:\/\/(?:calls\.pulsewire\.test|meet\.pulsewire\.test)\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(value);
}

/** Return a browser-safe URL, or null when the scheme is not navigable. */
function safeNavigationUrl(value) {
  try {
    const parsed = new URL(value);
    return new Set(["http:", "https:", "mailto:"]).has(parsed.protocol) ? value : null;
  } catch {
    return null;
  }
}

/** Render the authenticated application shell. */
async function enterWorkspace() {
  try {
    const [profile, channels] = await Promise.all([api("/api/me"), api("/api/channels")]);
    state.profile = profile;
    state.channels = channels.channels;
    $("#login-screen").classList.add("hidden");
    $("#app-shell").classList.remove("hidden");
    $("#user-name").textContent = profile.user.name;
    $("#user-role").textContent = profile.user.role.toLowerCase();
    $("#member-count").textContent = String(profile.workspace.members);
    const avatar = $("#user-avatar");
    avatar.firstChild.textContent = profile.user.initials;
    avatar.style.background = profile.user.color;
    renderChannels();
    navigate("channel", state.channelId);
  } catch (error) {
    clearSession();
    showLogin();
    $("#login-error").textContent = "Your session has expired. Sign in again.";
  }
}

function showLogin() {
  $("#login-screen").classList.remove("hidden");
  $("#app-shell").classList.add("hidden");
  if (state.pollTimer) clearInterval(state.pollTimer);
  setAuthMode("login");
}

/** Switch between the sign-in and self-service registration experiences. */
function setAuthMode(mode) {
  const registering = mode === "register";
  state.authMode = registering ? "register" : "login";
  $("#login-form").classList.toggle("hidden", registering);
  $("#register-form").classList.toggle("hidden", !registering);
  $("#social-login").classList.toggle("hidden", registering);
  $("#auth-eyebrow").textContent = registering ? "JOIN YOUR TEAM" : "WELCOME BACK";
  $("#auth-title").textContent = registering ? "Create your Pulsewire account" : "Sign in to your workspace";
  $("#auth-subtitle").innerHTML = registering
    ? 'Join <strong>Northstar Labs</strong> as a workspace member'
    : 'Continue to <strong>Northstar Labs</strong>';
  $("#auth-switch-copy").textContent = registering ? "Already have an account?" : "New to Pulsewire?";
  $("#auth-switch-button").textContent = registering ? "Sign in" : "Create an account";
  $("#login-error").textContent = "";
  $("#register-error").textContent = "";

  if (registering && $("#email").value && !$("#register-email").value) {
    $("#register-email").value = $("#email").value;
  } else if (!registering && $("#register-email").value && !$("#email").value) {
    $("#email").value = $("#register-email").value;
  }
}

function renderChannels() {
  const host = $("#channel-list");
  host.replaceChildren();
  for (const channel of state.channels) {
    const button = element("button", `channel-item ${channel.id === state.channelId && state.view === "channel" ? "active" : ""}`, channel.name);
    button.addEventListener("click", () => navigate("channel", channel.id));
    host.append(button);
  }
}

function setHeader(title, subtitle, showStar = false) {
  $("#view-title").textContent = title;
  $("#view-subtitle").textContent = subtitle;
  $(".star-button").style.display = showStar ? "inline" : "none";
}

function setActiveUtility(id) {
  $$(".utility-nav .nav-item").forEach((button) => button.classList.toggle("active", button.id === id));
  renderChannels();
}

function navigate(view, channelId) {
  state.view = view;
  if (channelId) state.channelId = channelId;
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  $("#app-shell").classList.remove("menu-open");

  if (view === "channel") {
    setActiveUtility("");
    renderChannelView();
  } else if (view === "integrations") {
    setActiveUtility("integrations-nav");
    renderIntegrations();
  } else if (view === "billing") {
    setActiveUtility("billing-nav");
    renderBilling();
  } else {
    toast("This area is part of the product shell and is not needed for this workspace demo.");
  }
}

async function renderChannelView() {
  const channel = state.channels.find((candidate) => candidate.id === state.channelId) || state.channels[0];
  setHeader(`# ${channel.name}`, channel.topic, true);
  const content = $("#content");
  content.innerHTML = `
    <section class="channel-view">
      <div id="messages-scroll" class="messages-scroll">
        <div class="channel-intro"><div class="channel-icon">#</div><h2>Welcome to #${channel.name}</h2><p>This is the start of the channel. ${channel.topic}</p></div>
        <div class="day-divider"><span>Today</span></div>
        <div id="messages-list"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line short"></div></div>
      </div>
      <div class="composer-wrap">
        <form id="composer" class="composer">
          <textarea id="composer-text" aria-label="Message" placeholder="Message #${channel.name}"></textarea>
          <div class="composer-actions"><button class="format-button" type="button">B</button><button class="format-button" type="button"><em>I</em></button><button class="format-button" type="button">⌕</button><button class="format-button" type="button">☺</button><button id="send-button" class="send-button" type="submit" disabled>➤</button></div>
        </form>
      </div>
    </section>`;
  const text = $("#composer-text");
  text.addEventListener("input", () => { $("#send-button").disabled = !text.value.trim(); });
  $("#composer").addEventListener("submit", sendMessage);
  await refreshMessages(true);
  state.pollTimer = setInterval(() => refreshMessages(false), 3000);
}

async function sendMessage(event) {
  event.preventDefault();
  const text = $("#composer-text");
  const value = text.value.trim();
  if (!value) return;
  try {
    await api(`/api/channels/${encodeURIComponent(state.channelId)}/messages`, { method: "POST", body: JSON.stringify({ text: value }) });
    text.value = "";
    $("#send-button").disabled = true;
    await refreshMessages(true);
  } catch (error) { toast(error.message, "error"); }
}

async function refreshMessages(scrollToBottom) {
  if (state.view !== "channel") return;
  try {
    const result = await api(`/api/channels/${encodeURIComponent(state.channelId)}/messages`);
    const host = $("#messages-list");
    if (!host) return;
    host.replaceChildren(...result.messages.map(renderMessage));
    if (scrollToBottom) {
      const scroll = $("#messages-scroll");
      scroll.scrollTop = scroll.scrollHeight;
    }
  } catch (error) { toast(error.message, "error"); }
}

function renderMessage(message) {
  const row = element("article", "message");
  const avatar = element("div", "message-avatar", message.author.initials);
  avatar.style.background = message.author.color;
  const body = element("div", "message-body");
  const meta = element("div", "message-meta");
  meta.append(element("strong", "", message.author.name));
  if (message.author.kind === "app") meta.append(element("span", "app-badge", "APP"));
  const time = element("time", "", formatTime(message.createdAt));
  time.dateTime = new Date(message.createdAt).toISOString();
  meta.append(time);

  const copy = element("div", "message-copy");
  for (const segment of message.renderedText || [{ type: "text", text: message.text }]) {
    if (segment.type === "link") {
      const anchor = element("a", "", segment.text);
      anchor.href = segment.url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      copy.append(anchor);
    } else {
      copy.append(document.createTextNode(segment.text));
    }
  }
  body.append(meta, copy);
  for (const attachment of message.attachments || []) body.append(renderAttachment(attachment));
  row.append(avatar, body);
  return row;
}

function renderAttachment(attachment) {
  const card = element("div", "attachment-card");
  const inner = element("div", "attachment-inner");
  const label = element("div", "attachment-label");
  label.append(element("span", "meeting-glyph", "⌁"), document.createTextNode("Pulsewire meetings"));
  const title = element("a", "attachment-title", attachment.title || "Open attachment");
  const rawUrl = attachment.title_link || "";
  const vulnerableMode = state.config.linkPolicy === "vulnerable";
  const meetingLink = vulnerableMode ? isMeetingLinkVulnerable(rawUrl) : isMeetingLinkFixed(rawUrl);
  const safeUrl = safeNavigationUrl(rawUrl);

  if (safeUrl) {
    title.href = safeUrl;
    title.target = "_blank";
    title.rel = "noopener noreferrer";
  } else {
    // Mirrors the framework's visible javascript:-href guard. The meeting click
    // handler below still receives the original server value in vulnerable mode.
    title.setAttribute("href", "javascript:throw new Error('Pulsewire blocked an unsafe link URL')");
  }

  if (meetingLink) {
    title.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!vulnerableMode && !safeUrl) return;
      const theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      const navigationTarget = `${rawUrl}?theme=${theme}&instantMeeting=false`;
      if (vulnerableMode && rawUrl.trim().toLowerCase().startsWith("javascript:")) {
        // The legacy compatibility branch opens a same-origin meeting window
        // before navigating it. Passing the unchecked value to Location is the
        // same imperative JavaScript-URL sink and remains reproducible on
        // browsers that now suppress javascript: in window.open directly.
        const meetingWindow = window.open("about:blank", "_blank");
        if (meetingWindow) meetingWindow.location.href = navigationTarget;
      } else {
        window.open(navigationTarget, "_blank");
      }
    });
  }
  inner.append(label, title, element("p", "attachment-text", attachment.text || "Shared from an integration"));
  const footer = element("div", "attachment-footer");
  footer.append(element("span", "", "Meeting invitation"), element("span", "", "Open ↗"));
  card.append(inner, footer);
  return card;
}

async function renderIntegrations() {
  setHeader("Integrations", "Connect tools and automate work in Northstar Labs");
  const content = $("#content");
  content.innerHTML = `
    <section class="page-view"><div class="page-container">
      <div class="page-heading"><div><h2>Incoming webhooks</h2><p>Send updates from your tools into a Pulsewire channel.</p></div></div>
      <div class="settings-grid">
        <section class="panel"><div class="panel-header"><h3>Create a webhook</h3><p>Choose a channel and give the connection a recognizable name.</p></div>
          <form id="webhook-form" class="panel-body">
            <label for="hook-name">Connection name</label><input id="hook-name" maxlength="64" value="Standup Assistant" required>
            <label for="hook-channel">Post to channel</label><select id="hook-channel">${state.channels.map((channel) => `<option value="${channel.id}"># ${channel.name}</option>`).join("")}</select>
            <p class="field-help">Anyone with the webhook URL can post to this channel. Keep it private.</p>
            <div class="form-actions"><button class="primary-button" type="submit">Create webhook</button></div>
          </form>
        </section>
        <section class="panel"><div class="panel-header"><h3>Your connections</h3><p>Webhooks created by your account.</p></div><div id="webhook-list"><div class="empty-state">Loading connections…</div></div></section>
      </div>
      <div class="permission-note" style="margin-top:18px"><span>ⓘ</span><div><strong>Workspace policy</strong><br>Members can create incoming webhooks. Installing marketplace applications remains restricted to workspace owners.</div></div>
    </div></section>`;
  $("#webhook-form").addEventListener("submit", createWebhook);
  await refreshWebhooks();
}

async function createWebhook(event) {
  event.preventDefault();
  const button = $("#webhook-form button[type=submit]");
  button.disabled = true;
  try {
    const result = await api(`/api/workspaces/${state.config.workspaceId}/incoming-webhooks`, {
      method: "POST",
      body: JSON.stringify({ name: $("#hook-name").value, channelId: $("#hook-channel").value }),
    });
    await navigator.clipboard?.writeText(`${location.origin}${result.postPath}`);
    toast("Webhook created. Its URL has been copied to your clipboard.");
    await refreshWebhooks();
  } catch (error) { toast(error.message, "error"); } finally { button.disabled = false; }
}

async function refreshWebhooks() {
  try {
    const result = await api(`/api/workspaces/${state.config.workspaceId}/incoming-webhooks`);
    const host = $("#webhook-list");
    if (!result.webhooks.length) {
      host.innerHTML = '<div class="empty-state"><strong>No webhooks yet</strong>Create your first connection to start posting updates.</div>';
      return;
    }
    host.replaceChildren(...result.webhooks.map((hook) => {
      const row = element("div", "integration-row");
      row.innerHTML = `<div class="integration-icon">⌁</div><div class="integration-copy"><strong></strong><small></small><code></code></div><span class="status-pill">Active</span>`;
      $("strong", row).textContent = hook.name;
      $("small", row).textContent = `${hook.createdBy} · ${state.channels.find((channel) => channel.id === hook.channelId)?.name || hook.channelId}`;
      $("code", row).textContent = `${location.origin}${hook.postPath}`;
      return row;
    }));
  } catch (error) { toast(error.message, "error"); }
}

async function renderBilling() {
  setHeader("Plans & billing", "Manage the Northstar Labs subscription");
  const content = $("#content");
  content.innerHTML = '<section class="page-view"><div class="page-container"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line short"></div></div></section>';
  try {
    const result = await api(`/api/workspaces/${state.config.workspaceId}/payments/customer`);
    content.innerHTML = `<section class="page-view"><div class="page-container"><div class="page-heading"><div><h2>Workspace billing</h2><p>Subscription details for Northstar Labs.</p></div></div><div class="billing-card panel"><div class="plan-banner"><span class="plan-chip">CURRENT PLAN</span><h3>${result.basicInfo.plan}</h3><p>Your workspace has ${result.basicInfo.seats} active seats.</p></div><div class="billing-details"><div class="detail-card"><span>Status</span><strong>${result.billingInfo.status}</strong></div><div class="detail-card"><span>Renewal</span><strong>${result.billingInfo.renewalDate}</strong></div><div class="detail-card"><span>Next invoice</span><strong>$${result.invoiceInfo.nextInvoice} ${result.invoiceInfo.currency}</strong></div></div></div></div></section>`;
  } catch (error) {
    if (error.status === 403) {
      content.innerHTML = `<section class="page-view"><div class="access-denied"><div class="denied-icon">◇</div><h2>Owner access required</h2><p>Only workspace owners can view subscription, invoices, and billing details. Ask an owner if you need help with the plan.</p><span class="error-code">403 · ${error.body?.code || 403000}</span></div></section>`;
    } else { toast(error.message, "error"); }
  }
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#login-button");
  const errorHost = $("#login-error");
  errorHost.textContent = "";
  button.disabled = true;
  button.textContent = "Signing in…";
  try {
    const result = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: $("#email").value, password: $("#password").value }),
    });
    saveSession({ accessToken: result.accessToken, refreshToken: result.refreshToken, workspaceId: result.workspaceId });
    await enterWorkspace();
  } catch (error) { errorHost.textContent = error.message; } finally { button.disabled = false; button.textContent = "Sign in to Pulsewire"; }
});

$("#register-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#register-button");
  const errorHost = $("#register-error");
  const password = $("#register-password").value;
  errorHost.textContent = "";
  if (password !== $("#register-confirm").value) {
    errorHost.textContent = "Passwords do not match.";
    return;
  }

  button.disabled = true;
  button.textContent = "Creating your workspace account…";
  try {
    const result = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        name: $("#register-name").value,
        email: $("#register-email").value,
        password,
      }),
    });
    saveSession({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      workspaceId: result.workspaceId,
    });
    toast(`Welcome to Northstar Labs, ${result.user.name}.`);
    await enterWorkspace();
  } catch (error) {
    errorHost.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Create my account";
  }
});

$("#toggle-password").addEventListener("click", () => {
  const input = $("#password");
  input.type = input.type === "password" ? "text" : "password";
});
$("#auth-switch-button").addEventListener("click", () => {
  setAuthMode(state.authMode === "login" ? "register" : "login");
});
$("#logout-button").addEventListener("click", () => { clearSession(); showLogin(); });
$("#integrations-nav").addEventListener("click", () => navigate("integrations"));
$("#billing-nav").addEventListener("click", () => navigate("billing"));
$("#mobile-menu").addEventListener("click", () => $("#app-shell").classList.toggle("menu-open"));
$$(".primary-nav .nav-item").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.view)));

(async function bootstrap() {
  try {
    state.config = await api("/api/config");
    const restored = restoreSession();
    if (restored) {
      state.session = restored;
      await enterWorkspace();
    } else {
      showLogin();
    }
  } catch (error) {
    $("#login-error").textContent = `Pulsewire is unavailable: ${error.message}`;
  }
})();
