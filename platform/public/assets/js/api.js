// Thin API client for the platform control plane.

const BASE = "/api";

/**
 * Perform a JSON request, throwing an Error (with `.status`) on failure.
 * @param {string} path
 * @param {RequestInit} [opts]
 * @returns {Promise<any>}
 */
async function request(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body && body.error) {
        message = body.error;
      }
    } catch {
      /* non-JSON error body */
    }
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }

  if (res.status === 204) {
    return null;
  }
  return res.json();
}

const enc = encodeURIComponent;

export const api = {
  /** @param {boolean} [refresh] */
  labs: (refresh) => request(`/labs${refresh ? "?refresh=1" : ""}`),
  lab: (id) => request(`/labs/${enc(id)}`),
  start: (id) => request(`/labs/${enc(id)}/start`, { method: "POST" }),
  stop: (id) => request(`/labs/${enc(id)}/stop`, { method: "POST" }),
  heartbeat: (id) =>
    request(`/labs/${enc(id)}/heartbeat`, { method: "POST" }).catch(() => {}),
  status: (id) => request(`/labs/${enc(id)}/status`),
  progress: () => request("/progress"),
  putProgress: (id, patch) =>
    request(`/progress/${enc(id)}`, { method: "PUT", body: JSON.stringify(patch) }),
  health: () => request("/health"),
  /**
   * Open the SSE event stream for a lab.
   * @param {string} id
   * @returns {EventSource}
   */
  events: (id) => new EventSource(`${BASE}/labs/${enc(id)}/events`),
};
