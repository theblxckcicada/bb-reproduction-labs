const WILDCARD_HOSTS = new Set(["0.0.0.0", "::"]);

/**
 * Remove URL brackets from an IPv6 hostname.
 * @param {string} hostname Browser hostname.
 * @returns {string}
 */
function unbracketHostname(hostname) {
  const trimmed = String(hostname).trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Build the browser-facing URL for a running lab.
 *
 * The page hostname is authoritative because BIND_HOST can be a wildcard
 * listening address and because the browser may reach the platform through a
 * LAN IP or DNS name that the server cannot infer safely.
 *
 * @param {{ port?: number, url?: string | null }} snapshot Runtime snapshot.
 * @param {{ hostname?: string } | undefined} locationLike Browser location.
 * @returns {string | null}
 */
export function resolveLabUrl(snapshot, locationLike = globalThis.location) {
  const port = snapshot?.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return snapshot?.url || null;
  }

  let hostname = unbracketHostname(locationLike?.hostname || "");
  if (!hostname) {
    return snapshot?.url || null;
  }
  if (WILDCARD_HOSTS.has(hostname)) {
    hostname = "localhost";
  }

  const urlHost = hostname.includes(":") ? `[${hostname}]` : hostname;
  return `http://${urlHost}:${port}`;
}
