// Ovawatch Labs — SPA controller. Owns the app shell, routing, live event
// stream per lab, the running-labs tray, and toast notifications.

import { api } from "./api.js";
import { createRouter } from "./router.js";
import { el, icon } from "./util.js";
import { statusPill } from "./ui.js";
import { buildCatalog } from "./views/catalog.js";
import { buildLabPage } from "./views/labPage.js";

const POLL_INTERVAL_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 30000;
const DISCLAIMER_ACK_KEY = "ovawatch-labs-ack-v1";

// ---- App state -------------------------------------------------------------
let labsData = { labs: [], facets: { categories: [], difficulties: [] }, meta: {} };
let catalogCtrl = null;
let labCtrl = null;
let currentLabId = null;
let sse = null;
let heartbeatTimer = null;
let lastLabStatus = null;
let router = null;

// ---- Shell elements --------------------------------------------------------
const appRoot = document.getElementById("app");
const outlet = el("div", { class: "content" });
const liveStat = el("div", { class: "topbar-stat" }, [el("span", { class: "dot" }), el("span", {}, "0 running")]);
const toasts = el("div", { class: "toasts" });
const trayHost = el("div");

function buildShell() {
  const brand = el(
    "div",
    {
      class: "brand",
      role: "button",
      tabindex: "0",
      "aria-label": "Ovawatch Labs — home",
      onclick: () => router.navigate("/"),
      onkeydown: (e) => {
        if (e.key === "Enter") router.navigate("/");
      },
    },
    [
      el("img", { class: "brand-mark", src: "/assets/logo_transparent.png", alt: "", width: "28", height: "28" }),
      el("div", { class: "brand-lockup" }, [
        el("div", { class: "brand-name" }, ["Ovawatch", el("span", { class: "brand-tag" }, "Labs")]),
        el("div", { class: "brand-sub" }, "Bug Bounty Repro Range"),
      ]),
    ]
  );

  const topbar = el("header", { class: "topbar" }, [
    el("div", { class: "topbar-inner" }, [brand, el("div", { class: "topbar-spacer" }), liveStat]),
  ]);

  appRoot.replaceChildren(topbar, outlet, buildFooter(), toasts, trayHost);
  appRoot.removeAttribute("aria-busy");
}

/**
 * Small warning glyph tinted via the `.warn-ico` class.
 * @param {number} [size]
 * @returns {HTMLElement}
 */
function warnIco(size = 15) {
  const glyph = icon("warn", size);
  glyph.classList.add("warn-ico");
  return glyph;
}

/**
 * Persistent footer disclaimer.
 * @returns {HTMLElement}
 */
function buildFooter() {
  return el("footer", { class: "footer" }, [
    el("div", { class: "footer-inner" }, [
      el("div", { class: "footer-disc" }, [
        warnIco(),
        el(
          "span",
          {},
          "Intentionally vulnerable software for local, educational, and authorized security testing only. Never deploy these labs to a public or shared network, and only apply what you learn to systems you own or are explicitly authorized to test."
        ),
      ]),
      el("div", { class: "footer-meta" }, [
        el("button", { class: "footer-link", onclick: () => showDisclaimer(true) }, "Disclaimer"),
        el("span", {}, "© 2026 Ovawatch Sec"),
      ]),
    ]),
  ]);
}

/**
 * Show the responsible-use disclaimer. On first visit it is an acknowledgement
 * gate (no dismiss until accepted); when reopened from the footer it is simply
 * informational and closeable.
 * @param {boolean} [force] Reopen even if already acknowledged.
 */
function showDisclaimer(force = false) {
  if (!force) {
    try {
      if (localStorage.getItem(DISCLAIMER_ACK_KEY)) {
        return;
      }
    } catch {
      /* storage blocked — show it anyway */
    }
  }
  if (document.querySelector(".modal-overlay")) {
    return;
  }

  const overlay = el("div", {
    class: "modal-overlay",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": "Responsible use disclaimer",
  });

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const accept = () => {
    try {
      localStorage.setItem(DISCLAIMER_ACK_KEY, "1");
    } catch {
      /* ignore */
    }
    close();
  };
  function onKey(e) {
    if (e.key === "Escape" && force) {
      close();
    }
  }

  // Only a reopened (already-acknowledged) dialog is dismissable by backdrop/Esc.
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay && force) {
      close();
    }
  });
  document.addEventListener("keydown", onKey);

  const item = (lead, rest) => el("li", {}, [el("strong", {}, lead), ` ${rest}`]);

  const card = el("div", { class: "modal-card" }, [
    el("div", { class: "modal-head" }, [warnIco(20), el("div", { class: "modal-title" }, "Responsible use")]),
    el("div", { class: "modal-body" }, [
      el(
        "p",
        {},
        "These labs are intentionally vulnerable, reproduced from real findings for education and authorized security research."
      ),
      el("ul", {}, [
        item("Run them locally.", "Never deploy these apps to the public internet or any shared/production network."),
        item(
          "Stay authorized.",
          "Only use techniques you learn here on systems you own or are explicitly permitted to test."
        ),
        item("Sanitized.", "Names, paths, and domains are changed; any resemblance to live systems is incidental."),
        item(
          "Your responsibility.",
          "You are accountable for complying with all applicable laws and program rules. The authors accept no liability for misuse."
        ),
      ]),
    ]),
    el("div", { class: "modal-actions" }, [
      force ? el("button", { class: "btn btn-ghost", onclick: close }, "Close") : null,
      el("button", { class: "btn btn-primary", onclick: accept }, force ? "Got it" : "I understand & accept"),
    ]),
  ]);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

// ---- Data ------------------------------------------------------------------
async function loadLabs(refresh = false) {
  const data = await api.labs(refresh);
  labsData = data;
  updateLiveStat();
  renderTray();
  if (catalogCtrl) {
    catalogCtrl.update(data.labs);
  }
  return data;
}

function updateLiveStat() {
  const running = labsData.labs.filter((l) => l.runtimeStatus.status === "running").length;
  liveStat.classList.toggle("live", running > 0);
  liveStat.lastChild.textContent = `${running} running`;
}

function renderTray() {
  const active = labsData.labs.filter((l) => l.runtimeStatus.status !== "stopped");
  trayHost.replaceChildren();
  if (!active.length) {
    return;
  }
  const items = active.map((l) =>
    el("div", { class: "tray-item" }, [
      statusPill(l.runtimeStatus.status),
      el(
        "span",
        {
          class: "name",
          title: l.title,
          onclick: () => router.navigate(`/lab/${encodeURIComponent(l.id)}`),
        },
        l.title
      ),
      l.runtimeStatus.status === "running"
        ? el("button", { class: "btn btn-ghost btn-sm", title: "Stop lab", onclick: () => stopLab(l.id) }, [
            icon("stop", 11),
          ])
        : null,
    ])
  );
  trayHost.appendChild(
    el("div", { class: "tray" }, [
      el("div", { class: "tray-head" }, [
        el("span", {}, `Running · ${active.length}`),
        labsData.meta && labsData.meta.maxConcurrent
          ? el("span", { class: "faint" }, `max ${labsData.meta.maxConcurrent}`)
          : null,
      ]),
      ...items,
    ])
  );
}

// ---- Views -----------------------------------------------------------------
function showCatalog() {
  teardownLab();
  catalogCtrl = buildCatalog({
    data: labsData,
    handlers: {
      openLab: (id) => router.navigate(`/lab/${encodeURIComponent(id)}`),
      refresh: doRefresh,
    },
  });
  outlet.replaceChildren(catalogCtrl.node);
}

async function showLab(id) {
  teardownLab();
  catalogCtrl = null;

  let detail;
  try {
    detail = await api.lab(id);
  } catch (error) {
    toast("error", `Could not load lab: ${error.message}`);
    router.navigate("/");
    return;
  }

  currentLabId = id;
  lastLabStatus = detail.runtimeStatus ? detail.runtimeStatus.status : "stopped";

  labCtrl = buildLabPage({
    lab: detail,
    progress: detail.progress,
    handlers: {
      back: () => router.navigate("/"),
      start: () => startLab(id),
      stop: () => stopLab(id),
      setProgress: (state) =>
        api.putProgress(id, { state }).then(() => loadLabs()).catch((e) => toast("error", e.message)),
      revealHints: (count) => api.putProgress(id, { revealedHints: count }).catch(() => {}),
    },
  });
  outlet.replaceChildren(labCtrl.node);
  openSse(id);
}

// ---- Lifecycle actions -----------------------------------------------------
async function startLab(id) {
  try {
    const snapshot = await api.start(id);
    labCtrl?.applyStatus(snapshot);
    loadLabs();
  } catch (error) {
    toast("error", error.message);
  }
}

async function stopLab(id) {
  try {
    await api.stop(id);
    loadLabs();
  } catch (error) {
    toast("error", error.message);
  }
}

// ---- SSE -------------------------------------------------------------------
function openSse(id) {
  closeSse();
  sse = api.events(id);
  sse.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (data.kind === "status") {
      labCtrl?.applyStatus(data);
      handleStatusTransition(id, data);
    } else if (data.kind === "log") {
      labCtrl?.appendLog(data);
    }
  };
  sse.onerror = () => {
    // EventSource reconnects automatically; nothing to do.
  };
}

function closeSse() {
  if (sse) {
    sse.close();
    sse = null;
  }
}

function handleStatusTransition(id, data) {
  if (data.status === "running") {
    startHeartbeat(id);
  } else {
    stopHeartbeat();
  }

  if (data.status !== lastLabStatus) {
    if (data.status === "running") {
      toast("success", "Lab is ready — open it from the console.");
    } else if (data.status === "error") {
      toast("error", data.error || "Lab failed to start. Check the console output.");
    } else if (data.status === "stopped" && lastLabStatus && lastLabStatus !== "stopped") {
      toast("info", "Lab stopped.");
    }
    lastLabStatus = data.status;
  }

  // Keep the tray / live counter in sync with lifecycle changes.
  loadLabs();
}

// ---- Heartbeat (keeps a viewed running lab alive) --------------------------
function startHeartbeat(id) {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => api.heartbeat(id), HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function teardownLab() {
  closeSse();
  stopHeartbeat();
  labCtrl?.destroy();
  labCtrl = null;
  currentLabId = null;
  lastLabStatus = null;
}

// ---- Toasts ----------------------------------------------------------------
function toast(kind, message) {
  const node = el("div", { class: `toast toast-${kind}` }, message);
  toasts.appendChild(node);
  setTimeout(() => {
    node.style.opacity = "0";
    setTimeout(() => node.remove(), 200);
  }, 4000);
}

// ---- Misc ------------------------------------------------------------------
function doRefresh() {
  loadLabs(true)
    .then(() => toast("info", "Catalog refreshed."))
    .catch((e) => toast("error", e.message));
}

function startPolling() {
  setInterval(() => {
    loadLabs().catch(() => {
      /* transient; next tick retries */
    });
  }, POLL_INTERVAL_MS);
}

// ---- Bootstrap -------------------------------------------------------------
async function init() {
  buildShell();
  showDisclaimer();

  router = createRouter(
    [
      { pattern: /^\/$/, handler: () => showCatalog() },
      { pattern: /^\/lab\/(?<id>[^/]+)$/, handler: ({ id }) => showLab(decodeURIComponent(id)) },
    ],
    () => router.navigate("/")
  );

  try {
    await loadLabs();
  } catch (error) {
    outlet.replaceChildren(
      el("div", { class: "empty" }, `Could not reach the platform API: ${error.message}`)
    );
  }

  startPolling();
  router.start();
}

init();
