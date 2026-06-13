"use strict";

/**
 * REST + SSE API for labs.
 *
 * Catalog responses intentionally omit hint/solution text so spoilers are not
 * shipped to the grid view; the detail endpoint includes them and the client
 * gates them behind progressive reveal / spoiler controls.
 */

const fs = require("node:fs");
const path = require("node:path");
const express = require("express");

const config = require("../config");
const logger = require("../logger").child("api");
const { httpError } = require("../httpError");
const registry = require("../labs/registry");
const manager = require("../runtime/instanceManager");
const progress = require("../store/progressStore");

const router = express.Router();

/**
 * Whether a lab already has its dependencies installed.
 * @param {object} lab
 * @returns {boolean}
 */
function depsInstalled(lab) {
  if (!lab.runtime.install) {
    return true; // nothing to install
  }
  return fs.existsSync(path.join(lab.paths.dir, "node_modules"));
}

/**
 * Resolve a lab by id or throw a 404.
 * @param {string} id
 * @returns {object}
 */
function requireLab(id) {
  const lab = registry.getById(id);
  if (!lab) {
    throw httpError(404, `Unknown lab: ${id}`);
  }
  return lab;
}

/**
 * Catalog DTO (no spoilers).
 * @param {object} lab
 * @returns {object}
 */
function toCatalogDTO(lab) {
  return {
    id: lab.id,
    title: lab.title,
    summary: lab.summary,
    difficulty: lab.difficulty,
    categories: lab.categories,
    tags: lab.tags,
    vulnType: lab.vulnType,
    estimatedMinutes: lab.estimatedMinutes,
    author: lab.author,
    hintCount: lab.hints.length,
    hasSolution: Boolean(lab.solution),
    hasManifest: lab.hasManifest,
    source: lab.source,
    depsInstalled: depsInstalled(lab),
    runtimeStatus: manager.getStatus(lab.id),
    progress: progress.get(lab.id),
  };
}

/**
 * Detail DTO (includes brief, objectives, hints, solution, links).
 * @param {object} lab
 * @returns {object}
 */
function toDetailDTO(lab) {
  return {
    ...toCatalogDTO(lab),
    reportRef: lab.reportRef,
    brief: lab.brief,
    objectives: lab.objectives,
    hints: lab.hints,
    solution: lab.solution,
    links: lab.links,
    warnings: lab.warnings,
    folderName: lab.folderName,
    relPath: path.relative(config.labsDir, lab.paths.dir),
    runtime: {
      install: lab.runtime.install,
      start: lab.runtime.start,
      readyPath: lab.runtime.readyPath,
      defaultPort: lab.runtime.defaultPort,
      portEnv: lab.runtime.portEnv,
    },
  };
}

// ---- Catalog ---------------------------------------------------------------

router.get("/labs", (req, res) => {
  const force = req.query.refresh === "1";
  const labs = registry.getAll(force).map(toCatalogDTO);
  const categories = [...new Set(labs.flatMap((l) => l.categories))].sort();
  res.json({
    labs,
    facets: {
      categories,
      difficulties: ["easy", "medium", "hard", "insane"],
    },
    meta: {
      brand: config.brand,
      maxConcurrent: config.maxConcurrent,
      activeCount: manager.listActive().length,
    },
  });
});

router.get("/labs/:id", (req, res) => {
  const lab = requireLab(req.params.id);
  res.json(toDetailDTO(lab));
});

// ---- Lifecycle -------------------------------------------------------------

router.post("/labs/:id/start", (req, res) => {
  const lab = requireLab(req.params.id);
  const snapshot = manager.start(lab.id);
  progress.markStarted(lab.id);
  res.status(202).json(snapshot);
});

router.post("/labs/:id/stop", async (req, res, next) => {
  try {
    requireLab(req.params.id);
    const result = await manager.stop(req.params.id, "user");
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/labs/:id/heartbeat", (req, res) => {
  manager.heartbeat(req.params.id);
  res.status(204).end();
});

router.get("/labs/:id/status", (req, res) => {
  requireLab(req.params.id);
  res.json(manager.getStatus(req.params.id));
});

router.get("/labs/:id/logs", (req, res) => {
  requireLab(req.params.id);
  res.json({ logs: manager.getLogs(req.params.id) });
});

// ---- Live events (SSE) -----------------------------------------------------

router.get("/labs/:id/events", (req, res) => {
  const lab = requireLab(req.params.id);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  // Initial snapshot + buffered log backlog so a late subscriber is in sync.
  send({ kind: "status", ...manager.getStatus(lab.id) });
  for (const entry of manager.getLogs(lab.id)) {
    send({ kind: "log", ...entry });
  }

  const onEvent = (event) => {
    if (event.labId === lab.id) {
      send(event);
    }
  };
  manager.on("lab-event", onEvent);

  // Comment ping keeps proxies / the connection alive.
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  ping.unref?.();

  req.on("close", () => {
    clearInterval(ping);
    manager.off("lab-event", onEvent);
  });
});

// ---- Manual catalog refresh ------------------------------------------------

router.post("/labs-refresh", (req, res) => {
  const count = registry.refresh().length;
  logger.info(`Catalog manually refreshed (${count} labs).`);
  res.json({ count });
});

module.exports = router;
