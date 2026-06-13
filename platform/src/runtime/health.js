"use strict";

/**
 * Readiness probing for a freshly launched lab.
 *
 * A lab is "ready" as soon as its HTTP server answers on the assigned port —
 * any status code counts (even 404/500 means the server is listening and
 * routing). Connection-refused / reset errors mean "not up yet, keep polling".
 */

const http = require("node:http");

const POLL_INTERVAL_MS = 300;
const PER_REQUEST_TIMEOUT_MS = 2000;

/**
 * Issue a single readiness request.
 * @param {{ host: string, port: number, path: string }} target
 * @returns {Promise<boolean>} Resolves true if the server answered.
 */
function probeOnce({ host, port, path }) {
  return new Promise((resolve) => {
    const req = http.request(
      { host, port, path, method: "GET", timeout: PER_REQUEST_TIMEOUT_MS },
      (res) => {
        res.resume(); // drain and discard the body
        resolve(true);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/**
 * Poll the target until it responds or the overall timeout elapses.
 * @param {object} options
 * @param {string} options.host
 * @param {number} options.port
 * @param {string} options.path
 * @param {number} options.timeoutMs Overall budget.
 * @param {AbortSignal} [options.signal] Cancels the wait (e.g. on stop).
 * @returns {Promise<void>} Resolves when ready, rejects on timeout/abort.
 */
async function waitForReady({ host, port, path, timeoutMs, signal }) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new Error("Readiness wait aborted.");
    }

    // eslint-disable-next-line no-await-in-loop -- sequential polling is intentional.
    const ready = await probeOnce({ host, port, path });
    if (ready) {
      return;
    }

    // eslint-disable-next-line no-await-in-loop
    await delay(POLL_INTERVAL_MS, signal);
  }

  throw new Error(
    `Lab did not become ready within ${Math.round(timeoutMs / 1000)}s on ${host}:${port}.`
  );
}

/**
 * Promise-based delay that rejects early if the abort signal fires.
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new Error("Readiness wait aborted."));
        },
        { once: true }
      );
    }
  });
}

module.exports = { waitForReady };
