"use strict";

/**
 * Lab instance lifecycle manager.
 *
 * Owns the state machine for every launched lab: install (once) → start →
 * readiness → running → stop. Enforces the concurrency cap, auto-stops idle
 * labs, keeps a capped per-lab log buffer, and emits events that the SSE route
 * relays to the browser console. One instance per lab id (single-user model).
 */

const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");

const config = require("../config");
const logger = require("../logger").child("instances");
const { httpError } = require("../httpError");
const registry = require("../labs/registry");
const portPool = require("./portPool");
const { runToCompletion, startLongRunning, killTree } = require("./processRunner");
const { waitForReady } = require("./health");

/** Statuses that count against the concurrency cap / mean "occupied". */
const ACTIVE_STATUSES = new Set(["installing", "starting", "running", "stopping"]);

class InstanceManager extends EventEmitter {
  constructor() {
    super();
    // Each open SSE console subscribes a listener; allow many without warnings.
    this.setMaxListeners(0);
    /** @type {Map<string, object>} labId → instance */
    this.instances = new Map();
  }

  /**
   * Public snapshot of an instance (no internal handles).
   * @param {object} inst
   * @returns {object}
   */
  snapshot(inst) {
    return {
      labId: inst.labId,
      status: inst.status,
      port: inst.port,
      url: inst.url,
      pid: inst.pid,
      startedAt: inst.startedAt,
      readyAt: inst.readyAt,
      uptimeMs: inst.readyAt ? Date.now() - inst.readyAt : null,
      error: inst.error,
    };
  }

  /**
   * Status for a lab whether or not it has a live instance.
   * @param {string} labId
   * @returns {object}
   */
  getStatus(labId) {
    const inst = this.instances.get(labId);
    return inst ? this.snapshot(inst) : { labId, status: "stopped" };
  }

  /**
   * All currently-tracked (active) instances.
   * @returns {object[]}
   */
  listActive() {
    return [...this.instances.values()].map((inst) => this.snapshot(inst));
  }

  /**
   * Buffered logs for a lab (for SSE backlog / REST).
   * @param {string} labId
   * @returns {Array<object>}
   */
  getLogs(labId) {
    const inst = this.instances.get(labId);
    return inst ? [...inst.logs] : [];
  }

  /**
   * Start (or return the already-running) instance for a lab.
   * @param {string} labId
   * @returns {object} Snapshot of the instance.
   */
  start(labId) {
    const lab = registry.getById(labId);
    if (!lab) {
      throw httpError(404, `Unknown lab: ${labId}`);
    }

    const existing = this.instances.get(labId);
    if (existing) {
      if (existing.status === "stopping") {
        throw httpError(409, "Lab is stopping; try again in a moment.");
      }
      return this.snapshot(existing);
    }

    const activeCount = [...this.instances.values()].filter((i) =>
      ACTIVE_STATUSES.has(i.status)
    ).length;
    if (activeCount >= config.maxConcurrent) {
      throw httpError(
        429,
        `Concurrency limit reached (${config.maxConcurrent} labs). Stop one and retry.`
      );
    }

    const inst = this.#createInstance(lab);
    this.instances.set(labId, inst);
    this.#setStatus(inst, "starting");

    // Orchestrate in the background; the caller gets an immediate snapshot and
    // follows progress over SSE.
    this.#orchestrate(inst, lab).catch((error) => this.#fail(inst, error));

    return this.snapshot(inst);
  }

  /**
   * Stop a lab and free its resources.
   * @param {string} labId
   * @param {string} [reason]
   * @returns {Promise<object>}
   */
  async stop(labId, reason = "user") {
    const inst = this.instances.get(labId);
    if (!inst) {
      return { labId, status: "stopped" };
    }
    if (inst._stopping) {
      return this.snapshot(inst);
    }

    inst._stopping = true;
    this.#setStatus(inst, "stopping");
    this.#log(inst, `Stopping lab (${reason}).`, "system");

    this.#clearIdleTimer(inst);
    inst.readyAbort?.abort();

    try {
      await killTree(inst.child);
    } catch (error) {
      logger.warn(`Error killing lab ${labId}: ${error.message}`);
    }

    if (inst.port !== null) {
      portPool.release(inst.port);
    }
    this.instances.delete(labId);

    this.emit("lab-event", { labId, kind: "status", status: "stopped", port: null, url: null });
    logger.info(`Stopped lab ${labId} (${reason}).`);
    return { labId, status: "stopped" };
  }

  /**
   * Reset a lab's idle timer (called on user activity from the UI).
   * @param {string} labId
   */
  heartbeat(labId) {
    const inst = this.instances.get(labId);
    if (inst && inst.status === "running") {
      inst.lastActivity = Date.now();
      this.#resetIdleTimer(inst);
    }
  }

  /**
   * Stop every running lab (used on platform shutdown).
   * @returns {Promise<void>}
   */
  async stopAll() {
    const ids = [...this.instances.keys()];
    await Promise.all(ids.map((id) => this.stop(id, "shutdown").catch(() => {})));
  }

  // ---- internals -----------------------------------------------------------

  /**
   * @param {object} lab
   * @returns {object}
   */
  #createInstance(lab) {
    return {
      labId: lab.id,
      status: "starting",
      port: null,
      url: null,
      pid: null,
      child: null,
      startedAt: Date.now(),
      readyAt: null,
      lastActivity: Date.now(),
      error: null,
      exited: null,
      logs: [],
      logSeq: 0,
      idleTimer: null,
      readyAbort: null,
      _stopping: false,
    };
  }

  /**
   * Drive a single instance from install through to running.
   * @param {object} inst
   * @param {object} lab
   */
  async #orchestrate(inst, lab) {
    const installCwd = lab.paths.dir;
    const startCwd = registry.resolveWorkingDir(lab);

    // 1. Install dependencies once, if required and missing.
    if (lab.runtime.install && this.#needsInstall(installCwd)) {
      this.#setStatus(inst, "installing");
      this.#log(inst, `Installing dependencies: ${lab.runtime.install}`, "system");
      await runToCompletion({
        command: lab.runtime.install,
        cwd: installCwd,
        env: { ...process.env },
        timeoutMs: config.installTimeoutMs,
        onLog: (line, stream) => this.#log(inst, line, stream),
      });
      this.#log(inst, "Dependencies installed.", "system");
    }

    if (inst._stopping) {
      return;
    }

    // 2. Allocate a port and prepare the environment.
    inst.port = await portPool.allocate();
    inst.url = `http://${config.host}:${inst.port}`;
    const env = this.#buildEnv(lab, inst.port);

    // 3. Launch the lab server.
    this.#setStatus(inst, "starting");
    this.#log(inst, `Starting on ${inst.url} → ${lab.runtime.start}`, "system");
    inst.readyAbort = new AbortController();

    inst.child = startLongRunning({
      command: lab.runtime.start,
      cwd: startCwd,
      env,
      onLog: (line, stream) => this.#log(inst, line, stream),
      onExit: ({ code, signal }) => this.#onChildExit(inst, code, signal),
    });
    inst.pid = inst.child.pid ?? null;

    // 4. Wait until it answers HTTP (or fails / aborts).
    await waitForReady({
      host: config.host,
      port: inst.port,
      path: lab.runtime.readyPath,
      timeoutMs: config.startTimeoutMs,
      signal: inst.readyAbort.signal,
    });

    if (inst._stopping) {
      return;
    }

    // 5. Running.
    inst.readyAt = Date.now();
    inst.lastActivity = Date.now();
    this.#setStatus(inst, "running");
    this.#log(inst, `Lab is ready at ${inst.url}`, "system");
    this.#resetIdleTimer(inst);
  }

  /**
   * Whether a `node_modules` directory is absent in the install dir.
   * @param {string} cwd
   * @returns {boolean}
   */
  #needsInstall(cwd) {
    return !fs.existsSync(path.join(cwd, "node_modules"));
  }

  /**
   * Build the child environment, injecting the assigned port and base URL.
   * @param {object} lab
   * @param {number} port
   * @returns {NodeJS.ProcessEnv}
   */
  #buildEnv(lab, port) {
    const env = { ...process.env, ...lab.runtime.env };
    env[lab.runtime.portEnv] = String(port);
    env.PORT = String(port);
    env.HOST = config.host;
    env.BASE_URL = `http://${config.host}:${port}`;
    if (!env.NODE_ENV) {
      env.NODE_ENV = "development";
    }
    return env;
  }

  /**
   * Handle the lab process exiting.
   * @param {object} inst
   * @param {number | null} code
   * @param {string | null} signal
   */
  #onChildExit(inst, code, signal) {
    inst.exited = { code, signal };

    if (inst._stopping || inst.status === "stopping") {
      return; // expected during a stop
    }

    // Unexpected exit: abort any pending readiness wait and surface an error.
    inst.readyAbort?.abort();
    const detail = signal ? `signal ${signal}` : `code ${code}`;
    this.#fail(inst, new Error(`Lab process exited unexpectedly (${detail}).`));
  }

  /**
   * Move an instance into the error state and clean up resources.
   * @param {object} inst
   * @param {Error} error
   */
  #fail(inst, error) {
    if (inst._stopping) {
      return;
    }
    inst.error = error.message;
    this.#log(inst, `Error: ${error.message}`, "stderr");
    logger.warn(`Lab ${inst.labId} failed: ${error.message}`);

    this.#clearIdleTimer(inst);
    killTree(inst.child).catch(() => {});
    if (inst.port !== null) {
      portPool.release(inst.port);
      inst.port = null;
      inst.url = null;
    }
    this.#setStatus(inst, "error");

    // Drop the instance after a short grace period so the UI can read the error,
    // then a fresh start is allowed.
    setTimeout(() => {
      const current = this.instances.get(inst.labId);
      if (current === inst && current.status === "error") {
        this.instances.delete(inst.labId);
      }
    }, 30000).unref?.();
  }

  /**
   * Update status and emit a status event.
   * @param {object} inst
   * @param {string} status
   */
  #setStatus(inst, status) {
    inst.status = status;
    this.emit("lab-event", {
      labId: inst.labId,
      kind: "status",
      status,
      port: inst.port,
      url: inst.url,
      pid: inst.pid,
      error: inst.error,
      startedAt: inst.startedAt,
      readyAt: inst.readyAt,
    });
  }

  /**
   * Append a log line to the ring buffer and emit a log event.
   * @param {object} inst
   * @param {string} line
   * @param {"stdout" | "stderr" | "system"} stream
   */
  #log(inst, line, stream) {
    const entry = { seq: (inst.logSeq += 1), ts: Date.now(), stream, line };
    inst.logs.push(entry);
    if (inst.logs.length > config.logBufferLines) {
      inst.logs.splice(0, inst.logs.length - config.logBufferLines);
    }
    this.emit("lab-event", { labId: inst.labId, kind: "log", ...entry });
  }

  /**
   * @param {object} inst
   */
  #resetIdleTimer(inst) {
    this.#clearIdleTimer(inst);
    inst.idleTimer = setTimeout(() => {
      this.#log(inst, `Auto-stopping after ${config.idleTtlMs / 60000} min idle.`, "system");
      this.stop(inst.labId, "idle").catch(() => {});
    }, config.idleTtlMs);
    inst.idleTimer.unref?.();
  }

  /**
   * @param {object} inst
   */
  #clearIdleTimer(inst) {
    if (inst.idleTimer) {
      clearTimeout(inst.idleTimer);
      inst.idleTimer = null;
    }
  }
}

module.exports = new InstanceManager();
