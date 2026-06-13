"use strict";

/**
 * Lab discovery: scan the labs directory and build a normalized manifest for
 * every immediate subdirectory that looks like a lab.
 */

const fs = require("node:fs");
const path = require("node:path");

const logger = require("../logger").child("discovery");
const { buildManifest } = require("./manifest");

/**
 * A directory is treated as a lab when it contains either a package.json,
 * a server.js, or an explicit lab.json. Bookkeeping folders (node_modules,
 * dotfolders) are skipped.
 * @param {string} dir
 * @returns {boolean}
 */
function looksLikeLab(dir) {
  return (
    fs.existsSync(path.join(dir, "lab.json")) ||
    fs.existsSync(path.join(dir, "package.json")) ||
    fs.existsSync(path.join(dir, "server.js")) ||
    fs.existsSync(path.join(dir, "src", "server.js"))
  );
}

/**
 * Discover all labs under `labsDir`.
 * @param {string} labsDir Absolute path to the labs root.
 * @returns {object[]} Array of normalized manifests, sorted by id, ids deduped.
 */
function discoverLabs(labsDir) {
  if (!fs.existsSync(labsDir)) {
    logger.warn(`Labs directory does not exist: ${labsDir}`);
    return [];
  }

  const entries = fs.readdirSync(labsDir, { withFileTypes: true });
  const seenIds = new Map();
  const manifests = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name.startsWith(".") || entry.name === "node_modules") {
      continue;
    }

    const dir = path.join(labsDir, entry.name);
    if (!looksLikeLab(dir)) {
      logger.debug(`Skipping non-lab folder: ${entry.name}`);
      continue;
    }

    let manifest;
    try {
      manifest = buildManifest({ dir, folderName: entry.name });
    } catch (error) {
      logger.error(`Failed to build manifest for "${entry.name}": ${error.message}`);
      continue;
    }

    // Guarantee id uniqueness even if two folders slugify to the same id.
    let uniqueId = manifest.id;
    if (seenIds.has(uniqueId)) {
      const next = `${uniqueId}-${seenIds.get(uniqueId) + 1}`;
      seenIds.set(uniqueId, seenIds.get(uniqueId) + 1);
      logger.warn(`Duplicate lab id "${uniqueId}" from "${entry.name}" → using "${next}".`);
      uniqueId = next;
      manifest.id = uniqueId;
    }
    seenIds.set(uniqueId, 1);

    if (manifest.warnings.length > 0) {
      logger.debug(`"${manifest.id}" warnings: ${manifest.warnings.join(" | ")}`);
    }

    manifests.push(manifest);
  }

  manifests.sort((a, b) => a.id.localeCompare(b.id));
  logger.info(`Discovered ${manifests.length} lab(s) in ${labsDir}`);
  return manifests;
}

module.exports = { discoverLabs, looksLikeLab };
