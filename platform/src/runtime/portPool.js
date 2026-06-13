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
 * Check whether a TCP port is free to bind on the platform's host.
 * @param {number} port
 * @param {string} host
 * @returns {Promise<boolean>}
 */
function isPortFree(port, host) {
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
