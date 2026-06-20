"use strict";

/**
 * In-memory lab registry.
 *
 * Wraps discovery with a short-lived cache (so a catalog refresh doesn't hit
 * the filesystem on every request) and centralizes the path-safety check used
 * before the platform ever spawns anything from a lab directory.
 */

const path = require("node:path");

const config = require("../config");
const logger = require("../logger").child("registry");
const { discoverLabs } = require("./discovery");

const CACHE_TTL_MS = 5000;

/** @type {object[]} */
let cache = [];
/** @type {Map<string, object>} */
let byId = new Map();
let lastScan = 0;

/**
 * Refresh the registry from disk.
 * @returns {object[]}
 */
function refresh() {
  cache = discoverLabs(config.labsDir);
  byId = new Map(cache.map((lab) => [lab.id, lab]));
  lastScan = Date.now();
  return cache;
}

/**
 * Get all labs, refreshing from disk if the cache is stale.
 * @param {boolean} [force] Bypass the cache.
 * @returns {object[]}
 */
function getAll(force = false) {
  if (force || cache.length === 0 || Date.now() - lastScan > CACHE_TTL_MS) {
    return refresh();
  }
  return cache;
}

/**
 * Look up a lab by id (always considers a fresh-enough cache).
 * @param {string} id
 * @returns {object | null}
 */
function getById(id) {
  getAll();
  return byId.get(id) || null;
}

/**
 * Resolve and validate the absolute working directory for a lab's runtime,
 * guaranteeing it stays inside the configured labs root (defense against a
 * malicious `runtime.cwd` traversal).
 * @param {object} lab Normalized manifest.
 * @returns {string} Absolute, validated working directory.
 */
function resolveWorkingDir(lab) {
  const labsRoot = path.resolve(config.labsDir);
  const labDir = path.resolve(lab.paths.dir);

  if (labDir !== labsRoot && !labDir.startsWith(labsRoot + path.sep)) {
    throw new Error(`Lab directory escapes labs root: ${labDir}`);
  }

  const cwd = lab.runtime.cwd ? path.resolve(labDir, lab.runtime.cwd) : labDir;
  if (cwd !== labDir && !cwd.startsWith(labDir + path.sep)) {
    throw new Error(`runtime.cwd escapes the lab directory: ${cwd}`);
  }
  return cwd;
}

module.exports = { getAll, getById, refresh, resolveWorkingDir };
