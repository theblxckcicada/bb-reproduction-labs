// Minimal hash-based router.

/**
 * @typedef {{ pattern: RegExp, handler: (params: Record<string,string>) => void }} Route
 */

/**
 * Create a hash router.
 * @param {Route[]} routes
 * @param {() => void} [notFound]
 */
export function createRouter(routes, notFound) {
  function resolve() {
    const hash = location.hash.replace(/^#/, "") || "/";
    for (const route of routes) {
      const match = route.pattern.exec(hash);
      if (match) {
        route.handler(match.groups || {});
        return;
      }
    }
    if (notFound) {
      notFound();
    }
  }

  window.addEventListener("hashchange", resolve);

  return {
    start: resolve,
    /** @param {string} path */
    navigate(path) {
      if (location.hash === `#${path}`) {
        resolve(); // re-run handler even if the hash is unchanged
      } else {
        location.hash = path;
      }
    },
  };
}
