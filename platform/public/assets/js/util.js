// Small DOM + formatting helpers (no framework, no build step).

/**
 * Escape a string for safe insertion as text/HTML.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

/**
 * Tiny hyperscript: create an element with props and children.
 * `html` sets innerHTML (caller must pass already-safe markup, e.g. rendered
 * markdown); `text` sets textContent; `on*` registers listeners.
 * @param {string} tag
 * @param {Record<string, any>} [props]
 * @param {Array<Node|string|false|null>|Node|string} [children]
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) {
      continue;
    }
    if (key === "class") {
      node.className = value;
    } else if (key === "html") {
      node.innerHTML = value;
    } else if (key === "text") {
      node.textContent = value;
    } else if (key === "dataset") {
      Object.assign(node.dataset, value);
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in node && key !== "list") {
      try {
        node[key] = value;
      } catch {
        node.setAttribute(key, value);
      }
    } else {
      node.setAttribute(key, value);
    }
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const child of kids) {
    if (child == null || child === false) {
      continue;
    }
    node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/**
 * Inline SVG icon by name.
 * @param {string} name
 * @param {number} [size]
 * @returns {HTMLElement}
 */
export function icon(name, size = 14) {
  const paths = {
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    play: '<path d="M6 4l14 8-14 8z" fill="currentColor" stroke="none"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 13v6H5V5h6"/>',
    arrow: '<path d="M15 6l-6 6 6 6"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    warn: '<path d="M10.3 4.3 2.4 18.6A1.5 1.5 0 0 0 3.7 21h16.6a1.5 1.5 0 0 0 1.3-2.4L13.7 4.3a1.6 1.6 0 0 0-2.8 0z"/><path d="M12 9.5v4.2"/><path d="M12 17.4h.01"/>',
    shield: '<path d="M12 3l8 3v6c0 4.6-3.2 7.5-8 9-4.8-1.5-8-4.4-8-9V6z"/>',
  };
  const span = document.createElement("span");
  span.style.display = "inline-flex";
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${
    paths[name] || ""
  }</svg>`;
  return span;
}

/**
 * Human-friendly duration.
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  if (ms == null || ms < 0) {
    return "—";
  }
  const sec = Math.floor(ms / 1000);
  if (sec < 60) {
    return `${sec}s`;
  }
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) {
    return rem ? `${min}m ${rem}s` : `${min}m`;
  }
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

/**
 * Format a clock time (HH:MM:SS) from an epoch ms value.
 * @param {number} ts
 * @returns {string}
 */
export function formatClock(ts) {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}

/**
 * Debounce a function.
 * @param {Function} fn
 * @param {number} wait
 * @returns {Function}
 */
export function debounce(fn, wait = 150) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/**
 * Human label for a runtime status.
 * @param {string} status
 * @returns {string}
 */
export function statusLabel(status) {
  return (
    {
      stopped: "Stopped",
      installing: "Installing",
      starting: "Starting",
      running: "Running",
      stopping: "Stopping",
      error: "Error",
    }[status] || status
  );
}
