"use strict";

/**
 * Minimal levelled logger for the platform control plane.
 *
 * Intentionally tiny (no dependency): timestamped, level-filtered lines with an
 * optional structured metadata object. Use a scope via `logger.child("name")`
 * to prefix related log lines.
 */

const LEVELS = Object.freeze({ error: 0, warn: 1, info: 2, debug: 3 });

function resolveLevel() {
  const raw = (process.env.LOG_LEVEL || "info").toLowerCase();
  return raw in LEVELS ? LEVELS[raw] : LEVELS.info;
}

const activeLevel = resolveLevel();

/**
 * @param {keyof typeof LEVELS} level
 * @param {string} scope
 * @param {string} message
 * @param {Record<string, unknown>} [meta]
 */
function emit(level, scope, message, meta) {
  if (LEVELS[level] > activeLevel) {
    return;
  }

  const prefix = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)}`;
  const scopeTag = scope ? ` [${scope}]` : "";
  const line = `${prefix}${scopeTag} ${message}`;
  const hasMeta = meta && Object.keys(meta).length > 0;
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;

  stream.write(hasMeta ? `${line} ${safeStringify(meta)}\n` : `${line}\n`);
}

/**
 * Stringify metadata defensively so logging never throws (e.g. circular refs).
 * @param {unknown} value
 * @returns {string}
 */
function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable meta]";
  }
}

/**
 * Create a logger bound to a scope label.
 * @param {string} [scope]
 */
function createLogger(scope = "") {
  return {
    error: (message, meta) => emit("error", scope, message, meta),
    warn: (message, meta) => emit("warn", scope, message, meta),
    info: (message, meta) => emit("info", scope, message, meta),
    debug: (message, meta) => emit("debug", scope, message, meta),
    child: (childScope) => createLogger(scope ? `${scope}:${childScope}` : childScope),
  };
}

module.exports = createLogger();
