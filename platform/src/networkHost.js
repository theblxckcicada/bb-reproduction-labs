"use strict";

const net = require("node:net");

const IPV4_WILDCARD = "0.0.0.0";
const IPV6_WILDCARD = "::";

/**
 * Remove URL brackets from an IPv6 host when they are present.
 * @param {string} host Hostname or IP address.
 * @returns {string}
 */
function unbracketHost(host) {
  const trimmed = String(host).trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Return whether a host is a wildcard listening address.
 * @param {string} host Hostname or IP address.
 * @returns {boolean}
 */
function isWildcardHost(host) {
  const normalized = unbracketHost(host);
  return normalized === IPV4_WILDCARD || normalized === IPV6_WILDCARD;
}

/**
 * Resolve a host that the local control plane can actually connect to.
 * Wildcard addresses are valid listen targets but invalid destination URLs.
 * @param {string} bindHost Configured listening address.
 * @returns {string}
 */
function resolveConnectHost(bindHost) {
  const normalized = unbracketHost(bindHost);
  if (!isWildcardHost(normalized)) {
    return normalized;
  }
  if (normalized === IPV4_WILDCARD) {
    return "127.0.0.1";
  }
  return "::1";
}

/**
 * Format a hostname or address for use in a URL authority.
 * @param {string} host Hostname or IP address.
 * @returns {string}
 */
function formatUrlHost(host) {
  const normalized = unbracketHost(host);
  return net.isIP(normalized) === 6 ? `[${normalized}]` : normalized;
}

/**
 * Build an HTTP origin for a host and TCP port.
 * @param {string} host Hostname or IP address.
 * @param {number} port TCP port.
 * @returns {string}
 */
function buildHttpOrigin(host, port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError(`Invalid TCP port: ${port}`);
  }
  return `http://${formatUrlHost(host)}:${port}`;
}

module.exports = {
  buildHttpOrigin,
  formatUrlHost,
  isWildcardHost,
  resolveConnectHost,
  unbracketHost,
};
