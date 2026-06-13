// Shared visual atoms used across views.

import { el, statusLabel } from "./util.js";

/**
 * @param {string} difficulty
 * @returns {HTMLElement}
 */
export function difficultyBadge(difficulty) {
  return el("span", { class: `diff diff-${difficulty}` }, difficulty);
}

/**
 * @param {string} status
 * @returns {HTMLElement}
 */
export function statusPill(status) {
  return el("span", { class: `pill pill-${status}` }, statusLabel(status));
}

/**
 * @param {string} category
 * @returns {HTMLElement}
 */
export function categoryBadge(category) {
  return el("span", { class: "badge badge-cat" }, category);
}

/**
 * Capitalize the first letter.
 * @param {string} s
 * @returns {string}
 */
export function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
