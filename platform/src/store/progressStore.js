"use strict";

/**
 * Local, single-user progress store.
 *
 * Persists per-lab learning progress to a small JSON file. Writes are atomic
 * (temp file + rename) so an interrupted write cannot corrupt the store.
 */

const fs = require("node:fs");
const path = require("node:path");

const config = require("../config");
const logger = require("../logger").child("progress");

const VALID_STATES = new Set(["not-started", "in-progress", "completed"]);

/** @type {Record<string, object>} labId → progress entry */
let store = {};

/**
 * Load the store from disk into memory (called once at startup).
 */
function load() {
  try {
    if (fs.existsSync(config.progressFile)) {
      const raw = fs.readFileSync(config.progressFile, "utf8");
      const parsed = JSON.parse(raw || "{}");
      store = parsed && typeof parsed === "object" ? parsed : {};
      logger.info(`Loaded progress for ${Object.keys(store).length} lab(s).`);
    }
  } catch (error) {
    logger.warn(`Could not load progress file; starting fresh. ${error.message}`);
    store = {};
  }
}

/**
 * Persist the in-memory store to disk atomically.
 */
function persist() {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const tmp = path.join(config.dataDir, `progress.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
    fs.renameSync(tmp, config.progressFile);
  } catch (error) {
    logger.error(`Failed to persist progress: ${error.message}`);
  }
}

/**
 * Default entry for a lab not yet recorded.
 * @param {string} labId
 * @returns {object}
 */
function defaultEntry(labId) {
  return {
    labId,
    state: "not-started",
    revealedHints: 0,
    startedAt: null,
    completedAt: null,
  };
}

/**
 * @returns {Record<string, object>} Shallow copy of all progress entries.
 */
function getAll() {
  return { ...store };
}

/**
 * Get a single lab's progress (default if absent).
 * @param {string} labId
 * @returns {object}
 */
function get(labId) {
  return store[labId] ? { ...store[labId] } : defaultEntry(labId);
}

/**
 * Apply a validated partial update to a lab's progress.
 * @param {string} labId
 * @param {{ state?: string, revealedHints?: number }} patch
 * @returns {object} The updated entry.
 */
function update(labId, patch) {
  const entry = store[labId] || defaultEntry(labId);

  if (patch.state !== undefined) {
    if (!VALID_STATES.has(patch.state)) {
      throw new Error(`Invalid progress state: ${patch.state}`);
    }
    entry.state = patch.state;
    if (patch.state === "in-progress" && !entry.startedAt) {
      entry.startedAt = Date.now();
    }
    entry.completedAt = patch.state === "completed" ? Date.now() : null;
  }

  if (patch.revealedHints !== undefined) {
    const value = Number(patch.revealedHints);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error("revealedHints must be a non-negative integer.");
    }
    // Hints are sticky — never un-reveal.
    entry.revealedHints = Math.max(entry.revealedHints || 0, value);
  }

  store[labId] = entry;
  persist();
  return { ...entry };
}

/**
 * Convenience: mark a lab as started (no-op if already in progress/completed).
 * @param {string} labId
 */
function markStarted(labId) {
  const entry = store[labId];
  if (!entry || entry.state === "not-started") {
    update(labId, { state: "in-progress" });
  }
}

module.exports = { load, getAll, get, update, markStarted };
