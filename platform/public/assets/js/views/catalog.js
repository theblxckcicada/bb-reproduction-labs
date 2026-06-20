// Catalog view: searchable, filterable grid of lab cards.

import { el, icon, debounce } from "../util.js";
import { difficultyBadge, statusPill, categoryBadge, cap } from "../ui.js";

/**
 * Build the catalog view.
 * @param {object} options
 * @param {{ labs: object[], facets: object }} options.data
 * @param {{ openLab: (id: string) => void, refresh: () => void }} options.handlers
 * @returns {{ node: HTMLElement, update: (labs: object[]) => void }}
 */
export function buildCatalog({ data, handlers }) {
  let labs = data.labs;
  const facets = data.facets;
  const filters = { q: "", category: "", difficulty: "", status: "" };

  const grid = el("div", { class: "grid" });

  const searchInput = el("input", {
    type: "search",
    placeholder: "Search labs, categories, vuln types…",
    "aria-label": "Search labs",
    oninput: debounce((e) => {
      filters.q = e.target.value.trim().toLowerCase();
      render();
    }, 120),
  });

  const catSelect = el(
    "select",
    {
      class: "select",
      "aria-label": "Filter by category",
      onchange: (e) => {
        filters.category = e.target.value;
        render();
      },
    },
    [
      el("option", { value: "" }, "All categories"),
      ...facets.categories.map((c) => el("option", { value: c }, c)),
    ]
  );

  const diffSelect = el(
    "select",
    {
      class: "select",
      "aria-label": "Filter by difficulty",
      onchange: (e) => {
        filters.difficulty = e.target.value;
        render();
      },
    },
    [
      el("option", { value: "" }, "All levels"),
      ...facets.difficulties.map((d) => el("option", { value: d }, cap(d))),
    ]
  );

  const statusSelect = el(
    "select",
    {
      class: "select",
      "aria-label": "Filter by status",
      onchange: (e) => {
        filters.status = e.target.value;
        render();
      },
    },
    [
      el("option", { value: "" }, "Any status"),
      el("option", { value: "running" }, "Running"),
      el("option", { value: "stopped" }, "Stopped"),
    ]
  );

  const refreshBtn = el(
    "button",
    { class: "btn btn-ghost btn-sm", onclick: () => handlers.refresh(), title: "Re-scan the Labs directory" },
    [icon("refresh", 14), "Refresh"]
  );

  const toolbar = el("div", { class: "toolbar" }, [
    el("div", { class: "search" }, [icon("search", 15), searchInput]),
    catSelect,
    diffSelect,
    statusSelect,
    refreshBtn,
  ]);

  const head = el("div", { class: "page-head" }, [
    el("div", {}, [
      el("h1", { class: "page-title" }, "Lab Catalog"),
      el(
        "p",
        { class: "page-desc" },
        "Reproductions of real bug-bounty findings. Pick a lab and launch it — the platform handles install, ports, and lifecycle."
      ),
    ]),
  ]);

  /**
   * @param {object} lab
   * @returns {boolean}
   */
  function matches(lab) {
    if (filters.category && !lab.categories.includes(filters.category)) {
      return false;
    }
    if (filters.difficulty && lab.difficulty !== filters.difficulty) {
      return false;
    }
    if (filters.status) {
      const running = lab.runtimeStatus.status === "running";
      if (filters.status === "running" && !running) {
        return false;
      }
      if (filters.status === "stopped" && running) {
        return false;
      }
    }
    if (filters.q) {
      const hay = [lab.title, lab.summary, lab.vulnType, ...(lab.categories || []), ...(lab.tags || [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(filters.q)) {
        return false;
      }
    }
    return true;
  }

  /**
   * @param {object} lab
   * @returns {HTMLElement}
   */
  function card(lab) {
    const status = lab.runtimeStatus.status;
    const completed = lab.progress && lab.progress.state === "completed";

    const open = () => handlers.openLab(lab.id);

    return el(
      "div",
      {
        class: "card",
        tabindex: "0",
        role: "button",
        "aria-label": `Open ${lab.title}`,
        onclick: open,
        onkeydown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        },
      },
      [
        el("div", { class: "card-top" }, [
          el("div", { class: "card-title" }, lab.title),
          difficultyBadge(lab.difficulty),
        ]),
        el("div", { class: "card-summary" }, lab.summary || "No description provided."),
        el("div", { class: "card-foot" }, [
          ...(lab.categories || []).slice(0, 2).map(categoryBadge),
          lab.vulnType && !(lab.categories || []).length ? categoryBadge(lab.vulnType) : null,
          el("span", { class: "spacer" }),
          status !== "stopped" ? statusPill(status) : null,
          completed ? el("span", { class: "check" }, [icon("check", 12), "Done"]) : null,
        ]),
        el("div", { class: "card-foot" }, [
          el("span", { class: "card-id" }, lab.id),
          el("span", { class: "spacer" }),
          lab.estimatedMinutes ? el("span", { class: "card-id" }, `~${lab.estimatedMinutes} min`) : null,
        ]),
      ]
    );
  }

  function render() {
    grid.replaceChildren();
    const filtered = labs.filter(matches);
    if (!filtered.length) {
      grid.appendChild(
        el(
          "div",
          { class: "empty" },
          labs.length ? "No labs match your filters." : "No labs found in the Labs directory."
        )
      );
      return;
    }
    for (const lab of filtered) {
      grid.appendChild(card(lab));
    }
  }

  render();

  return {
    node: el("div", {}, [head, toolbar, grid]),
    update(newLabs) {
      labs = newLabs;
      render();
    },
  };
}
