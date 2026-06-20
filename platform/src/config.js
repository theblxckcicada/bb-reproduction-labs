"use strict";

/**
 * Central, env-driven configuration for the platform.
 *
 * Every value has a safe default so the platform runs with no `.env` file.
 * Values are validated at load time (fail fast) — a misconfiguration throws a
 * clear error on startup rather than surfacing as a confusing runtime fault.
 */

require("dotenv").config();

const path = require("path");

const PLATFORM_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(PLATFORM_ROOT, "..");

/**
 * Parse an inclusive "start-end" port range string.
 * @param {string | undefined} value Raw env value, e.g. "4100-4199".
 * @param {number} fallbackStart Default lower bound.
 * @param {number} fallbackEnd Default upper bound.
 * @returns {{ start: number, end: number }}
 */
function parsePortRange(value, fallbackStart, fallbackEnd) {
  if (!value) {
    return { start: fallbackStart, end: fallbackEnd };
  }

  const match = /^\s*(\d{2,5})\s*-\s*(\d{2,5})\s*$/.exec(value);
  if (!match) {
    throw new Error(
      `Invalid LAB_PORT_RANGE "${value}". Expected "<start>-<end>", e.g. "4100-4199".`
    );
  }

  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start > end) {
    throw new Error(`Invalid LAB_PORT_RANGE "${value}". Start must be <= end.`);
  }
  return { start, end };
}

/**
 * Read an integer env var with a default and basic bounds validation.
 * @param {string} name Env var name (for error messages).
 * @param {string | undefined} raw Raw value.
 * @param {number} fallback Default when unset.
 * @param {{ min?: number, max?: number }} [bounds] Optional inclusive bounds.
 * @returns {number}
 */
function parseIntEnv(name, raw, fallback, bounds = {}) {
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid ${name} "${raw}". Expected an integer.`);
  }
  if (bounds.min !== undefined && parsed < bounds.min) {
    throw new Error(`Invalid ${name} "${raw}". Minimum is ${bounds.min}.`);
  }
  if (bounds.max !== undefined && parsed > bounds.max) {
    throw new Error(`Invalid ${name} "${raw}". Maximum is ${bounds.max}.`);
  }
  return parsed;
}

const labsDir = process.env.LABS_DIR
  ? path.resolve(process.env.LABS_DIR)
  : path.join(REPO_ROOT, "Labs");

const portRange = parsePortRange(process.env.LAB_PORT_RANGE, 4100, 4199);
const platformPort = parseIntEnv("PORT", process.env.PORT, 8080, {
  min: 1,
  max: 65535,
});

if (platformPort >= portRange.start && platformPort <= portRange.end) {
  throw new Error(
    `Platform PORT ${platformPort} overlaps LAB_PORT_RANGE ${portRange.start}-${portRange.end}. ` +
      "Choose a platform port outside the lab range."
  );
}

const config = Object.freeze({
  brand: process.env.BRAND_NAME || "Ovawatch Labs",
  host: process.env.BIND_HOST || "127.0.0.1",
  port: platformPort,

  platformRoot: PLATFORM_ROOT,
  labsDir,
  publicDir: path.join(PLATFORM_ROOT, "public"),
  dataDir: path.join(PLATFORM_ROOT, "data"),
  progressFile: path.join(PLATFORM_ROOT, "data", "progress.json"),
  schemaFile: path.join(PLATFORM_ROOT, "schema", "lab.schema.json"),

  labPortRange: Object.freeze(portRange),
  maxConcurrent: parseIntEnv("MAX_CONCURRENT", process.env.MAX_CONCURRENT, 5, {
    min: 1,
    max: 50,
  }),
  idleTtlMs:
    parseIntEnv("IDLE_TTL_MIN", process.env.IDLE_TTL_MIN, 20, { min: 1 }) *
    60 *
    1000,
  startTimeoutMs: parseIntEnv(
    "START_TIMEOUT_MS",
    process.env.START_TIMEOUT_MS,
    60000,
    { min: 1000 }
  ),
  installTimeoutMs: parseIntEnv(
    "INSTALL_TIMEOUT_MS",
    process.env.INSTALL_TIMEOUT_MS,
    180000,
    { min: 1000 }
  ),
  logBufferLines: parseIntEnv(
    "LOG_BUFFER_LINES",
    process.env.LOG_BUFFER_LINES,
    500,
    { min: 50, max: 10000 }
  ),

  logLevel: process.env.LOG_LEVEL || "info",

  // Resolved absolute path of the Node executable, reused to launch labs so the
  // child process always uses the same runtime as the platform.
  nodeBin: process.execPath,
});

module.exports = config;
