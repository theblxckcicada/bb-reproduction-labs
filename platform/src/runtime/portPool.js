"use strict";

/**
 * Port allocator for launched labs.
 *
 * Hands out ports from the configured inclusive range, skipping ports already
 * handed out and ports the OS reports as busy (another process may hold one).
 */

const net = require("node:net");

const config = require("../config");
const logger = require("../logger").child("ports");

/** @type {Set<number>} */
const allocated = new Set();

/**
 * Whether we can bind the port on `host` ourselves.
 * @param {number} port
 * @param {string} host
 * @returns {Promise<boolean>}
 */
function canBind(port, host) {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once("error", () => resolve(false))
      .once("listening", () => {
        tester.close(() => resolve(true));
      })
      .listen(port, host);
  });
}

/**
 * Whether something is already accepting connections on the port. This is the
 * decisive check: labs call `app.listen(PORT)` with no host, so they bind the
 * unspecified address (IPv6 `::`, dual-stack). On Windows a bind probe on the
 * IPv4 `127.0.0.1` address can still SUCCEED against such a listener, which
 * would let us hand out an occupied port and latch the readiness check onto a
 * *different* lab. A connect probe reaches the dual-stack listener (via the
 * IPv4-mapped address) and reliably reports the port as busy.
 * @param {number} port
 * @param {string} host
 * @returns {Promise<boolean>}
 */
function isListening(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    let settled = false;
    const done = (busy) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(300);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false)); // ECONNREFUSED → nothing there
  });
}

/**
 * Check whether a TCP port is genuinely free: we must be able to bind it AND
 * nothing may already be listening on it (see isListening for the Windows
 * IPv4/IPv6 caveat that makes the bind test alone insufficient).
 * @param {number} port
 * @param {string} host
 * @returns {Promise<boolean>}
 */
async function isPortFree(port, host) {
  if (!(await canBind(port, host))) {
    return false;
  }
  if (await isListening(port, host)) {
    return false;
  }
  return true;
}

/**
 * Allocate a free port from the configured range.
 * @returns {Promise<number>}
 * @throws {Error} When no free port is available.
 */
async function allocate() {
  const { start, end } = config.labPortRange;
  for (let port = start; port <= end; port += 1) {
    if (allocated.has(port)) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- sequential probing is intentional.
    if (await isPortFree(port, config.host)) {
      allocated.add(port);
      logger.debug(`Allocated port ${port}`);
      return port;
    }
  }
  throw new Error(
    `No free port available in range ${start}-${end}. Stop a running lab and retry.`
  );
}

/**
 * Release a previously allocated port.
 * @param {number} port
 */
function release(port) {
  if (allocated.delete(port)) {
    logger.debug(`Released port ${port}`);
  }
}

/**
 * Number of ports currently allocated.
 * @returns {number}
 */
function inUseCount() {
  return allocated.size;
}

module.exports = { allocate, release, isPortFree, inUseCount };
