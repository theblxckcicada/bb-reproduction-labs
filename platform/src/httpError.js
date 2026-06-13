"use strict";

/**
 * Create an Error tagged with an HTTP status code, consumed by the central
 * error handler in the API layer.
 * @param {number} status HTTP status code.
 * @param {string} message Client-safe message.
 * @returns {Error & { status: number, expose: boolean }}
 */
function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = true; // message is safe to send to the client
  return error;
}

module.exports = { httpError };
