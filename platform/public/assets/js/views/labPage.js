// Lab detail view: briefing, objectives, progressive hints, spoiler-gated
// solution, and the live launch console (status + streaming logs).

import { el, icon, formatDuration, formatClock } from "../util.js";
import { difficultyBadge, statusPill, categoryBadge } from "../ui.js";
import { renderMarkdown } from "../markdown.js";

/**
 * Build the lab page.
 * @param {object} options
 * @param {object} options.lab Detail DTO.
 * @param {object} options.progress Progress entry.
 * @param {object} options.handlers { back, start, stop, setProgress, revealHints }
 * @returns {{ node: HTMLElement, applyStatus: Function, appendLog: Function, destroy: Function }}
 */
export function buildLabPage({ lab, progress, handlers }) {
  let snapshot = lab.runtimeStatus || { status: "stopped" };
  let revealed = (progress && progress.revealedHints) || 0;
  let progressState = (progress && progress.state) || "not-started";
  let solutionShown = false;
  let uptimeTimer = null;
  let hasLogs = false;

  // ---- Console (right rail) ------------------------------------------------
  const statusHost = el("div", { class: "console-status" });
  const actionsHost = el("div", { class: "console-actions" });
  const urlHost = el("div");
  const terminal = el("div", { class: "terminal", role: "log", "aria-live": "polite" });
  const metaHost = el("div");
  let uptimeValueEl = null;

  const clearBtn = el(
    "button",
    { class: "btn btn-ghost btn-sm", onclick: () => renderTerminalEmpty(), title: "Clear console" },
    "Clear"
  );

  const safetyGlyph = icon("warn", 13);
  safetyGlyph.classList.add("warn-ico");
  const safetyNote = el("div", { class: "console-note" }, [
    safetyGlyph,
    el(
      "span",
      {},
      "Intentionally vulnerable — runs locally on 127.0.0.1, for authorized educational use only."
    ),
  ]);

  const consolePanel = el("div", { class: "panel console-panel" }, [
    el("h2", {}, "Lab Console"),
    statusHost,
    actionsHost,
    safetyNote,
    urlHost,
    el(
      "div",
      { class: "console-status", style: "margin:4px 0 8px" },
      [el("span", { class: "k mono faint" }, "OUTPUT"), clearBtn]
    ),
    terminal,
    el("div", { class: "divider" }),
    metaHost,
    el("div", { class: "divider" }),
    renderProgressControl(),
  ]);

  function renderTerminalEmpty() {
    hasLogs = false;
    terminal.replaceChildren(
      el("div", { class: "term-empty" }, "Console output appears here once you launch the lab.")
    );
  }

  function renderStatus() {
    statusHost.replaceChildren(
      el("span", { class: "k mono faint" }, "STATUS"),
      statusPill(snapshot.status)
    );
  }

  function renderActions() {
    const status = snapshot.status;
    const children = [];

    if (status === "running") {
      children.push(
        el(
          "button",
          {
            class: "btn btn-primary",
            onclick: () =>
              snapshot.url && window.open(snapshot.url, "_blank", "noopener,noreferrer"),
          },
          [icon("external", 14), "Open Lab"]
        ),
        el("button", { class: "btn btn-danger", onclick: () => handlers.stop() }, [
          icon("stop", 12),
          "Stop",
        ])
      );
    } else if (status === "installing" || status === "starting") {
      children.push(
        el("button", { class: "btn", disabled: true }, status === "installing" ? "Installing…" : "Starting…"),
        el("button", { class: "btn btn-danger", onclick: () => handlers.stop() }, "Cancel")
      );
    } else if (status === "stopping") {
      children.push(el("button", { class: "btn", disabled: true }, "Stopping…"));
    } else {
      // stopped or error
      children.push(
        el("button", { class: "btn btn-primary", onclick: () => handlers.start() }, [
          icon("play", 13),
          "Launch lab",
        ])
      );
    }
    actionsHost.replaceChildren(...children);
  }

  function renderUrl() {
    urlHost.replaceChildren();
    if (snapshot.status === "running" && snapshot.url) {
      const copyBtn = el(
        "button",
        {
          class: "btn btn-ghost btn-sm",
          title: "Copy URL",
          onclick: () => navigator.clipboard?.writeText(snapshot.url),
        },
        [icon("copy", 12)]
      );
      urlHost.appendChild(
        el("div", { class: "lab-url" }, [el("span", {}, snapshot.url), copyBtn])
      );
    }
  }

  function renderMeta() {
    const rows = [];
    const add = (k, v) => rows.push(el("div", { class: "meta-row" }, [el("span", { class: "k" }, k), el("span", { class: "v" }, v)]));

    add("Port", snapshot.port ? String(snapshot.port) : "—");
    add("PID", snapshot.pid ? String(snapshot.pid) : "—");

    uptimeValueEl = el("span", { class: "v" }, currentUptime());
    rows.push(el("div", { class: "meta-row" }, [el("span", { class: "k" }, "Uptime"), uptimeValueEl]));

    add("Start", lab.runtime.start);
    add("Ready path", lab.runtime.readyPath);

    metaHost.replaceChildren(...rows);
  }

  function currentUptime() {
    if (snapshot.status === "running" && snapshot.readyAt) {
      return formatDuration(Date.now() - snapshot.readyAt);
    }
    return "—";
  }

  function manageUptimeTicker() {
    if (snapshot.status === "running" && snapshot.readyAt) {
      if (!uptimeTimer) {
        uptimeTimer = setInterval(() => {
          if (uptimeValueEl) {
            uptimeValueEl.textContent = currentUptime();
          }
        }, 1000);
      }
    } else if (uptimeTimer) {
      clearInterval(uptimeTimer);
      uptimeTimer = null;
    }
  }

  function renderProgressControl() {
    const host = el("div");
    const paint = () => {
      const done = progressState === "completed";
      host.replaceChildren(
        el(
          "button",
          {
            class: `btn ${done ? "btn-ghost" : "btn-primary"}`,
            style: "width:100%;justify-content:center",
            onclick: () => {
              const next = done ? "in-progress" : "completed";
              progressState = next;
              handlers.setProgress(next);
              paint();
            },
          },
          done ? [icon("check", 13), "Completed — mark incomplete"] : [icon("check", 13), "Mark as completed"]
        )
      );
    };
    paint();
    return host;
  }

  // ---- Left column ---------------------------------------------------------
  const left = el("div", {});

  left.appendChild(
    el("div", { class: "panel" }, [
      el("h2", {}, "Briefing"),
      el("div", { class: "md", html: renderMarkdown(lab.brief || lab.summary || "_No briefing provided._") }),
    ])
  );

  if (lab.objectives && lab.objectives.length) {
    left.appendChild(
      el("div", { class: "panel" }, [
        el("h2", {}, "Objectives"),
        el(
          "ul",
          { class: "objectives" },
          lab.objectives.map((o) => el("li", {}, o))
        ),
      ])
    );
  }

  if (lab.hints && lab.hints.length) {
    const hintsHost = el("div");
    const paintHints = () => {
      hintsHost.replaceChildren(
        ...lab.hints.map((hint, i) => {
          const locked = i >= revealed;
          const reveal = () => {
            revealed = Math.max(revealed, i + 1);
            handlers.revealHints(revealed);
            paintHints();
          };
          return el("div", { class: `hint ${locked ? "locked" : ""}` }, [
            el(
              "div",
              {
                class: "hint-head",
                ...(locked
                  ? {
                      role: "button",
                      tabindex: "0",
                      onclick: reveal,
                      onkeydown: (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          reveal();
                        }
                      },
                    }
                  : {}),
              },
              [
                el("span", {}, `Hint ${i + 1}`),
                locked
                  ? el("span", { class: "mono faint" }, [icon("lock", 12), " Reveal"])
                  : el("span", { class: "check" }, [icon("check", 12)]),
              ]
            ),
            el("div", { class: "hint-body" }, hint.text),
          ]);
        })
      );
    };
    paintHints();
    left.appendChild(el("div", { class: "panel" }, [el("h2", {}, "Hints"), hintsHost]));
  }

  if (lab.solution) {
    const solutionBody = el("div");
    const renderSolution = () => {
      if (solutionShown) {
        solutionBody.replaceChildren(el("div", { class: "md", html: renderMarkdown(lab.solution) }));
      } else {
        solutionBody.replaceChildren(
          el("div", { class: "spoiler-gate" }, [
            el("p", {}, "This reveals the full walkthrough and exploit steps."),
            el(
              "button",
              {
                class: "btn",
                onclick: () => {
                  solutionShown = true;
                  renderSolution();
                },
              },
              [icon("lock", 13), "Reveal solution"]
            ),
          ])
        );
      }
    };
    renderSolution();
    left.appendChild(el("div", { class: "panel" }, [el("h2", {}, "Solution"), solutionBody]));
  }

  if (lab.links && lab.links.length) {
    left.appendChild(
      el("div", { class: "panel" }, [
        el("h2", {}, "References"),
        el(
          "div",
          { style: "display:flex;flex-direction:column;gap:8px" },
          lab.links.map((link) =>
            el(
              "a",
              { href: link.url, target: "_blank", rel: "noopener noreferrer" },
              [link.label, " ", icon("external", 11)]
            )
          )
        ),
      ])
    );
  }

  // ---- Header + assembly ---------------------------------------------------
  const meta = el("div", { class: "lab-meta" }, [
    difficultyBadge(lab.difficulty),
    ...(lab.categories || []).map(categoryBadge),
    lab.vulnType ? el("span", { class: "badge" }, lab.vulnType) : null,
    lab.estimatedMinutes ? el("span", { class: "mono faint" }, `~${lab.estimatedMinutes} min`) : null,
    lab.author ? el("span", { class: "mono faint" }, lab.author) : null,
  ]);

  const node = el("div", {}, [
    el("button", { class: "back", type: "button", onclick: () => handlers.back() }, [
      icon("arrow", 13),
      "Back to catalog",
    ]),
    el("div", { class: "lab-head" }, [el("h1", { class: "lab-title" }, lab.title), meta]),
    !lab.hasManifest
      ? el(
          "div",
          { class: "warn-banner" },
          "Metadata inferred from package.json / README. Add a lab.json to curate the briefing, objectives, hints, and solution."
        )
      : null,
    el("div", { class: "lab-layout" }, [left, consolePanel]),
  ]);

  // Initial paint.
  renderStatus();
  renderActions();
  renderUrl();
  renderMeta();
  renderTerminalEmpty();
  manageUptimeTicker();

  return {
    node,
    /**
     * @param {object} newSnapshot
     */
    applyStatus(newSnapshot) {
      snapshot = { ...snapshot, ...newSnapshot };
      renderStatus();
      renderActions();
      renderUrl();
      renderMeta();
      manageUptimeTicker();
    },
    /**
     * @param {{ ts: number, stream: string, line: string }} entry
     */
    appendLog(entry) {
      if (!hasLogs) {
        terminal.replaceChildren();
        hasLogs = true;
      }
      const nearBottom =
        terminal.scrollTop + terminal.clientHeight >= terminal.scrollHeight - 40;
      terminal.appendChild(
        el("div", { class: `term-line term-${entry.stream}` }, [
          el("span", { class: "term-ts" }, formatClock(entry.ts)),
          el("span", { class: "term-msg" }, entry.line || " "),
        ])
      );
      if (nearBottom) {
        terminal.scrollTop = terminal.scrollHeight;
      }
    },
    destroy() {
      if (uptimeTimer) {
        clearInterval(uptimeTimer);
        uptimeTimer = null;
      }
    },
  };
}
