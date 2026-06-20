"use strict";

/**
 * Lab manifest builder.
 *
 * Produces a normalized, fully-populated manifest for a lab folder. If the
 * folder contains `lab.json` those values win; anything missing is inferred
 * from `package.json` and `README.md`. This is what lets the platform adapt to
 * new labs with zero or minimal metadata.
 */

const fs = require("node:fs");
const path = require("node:path");

const DIFFICULTIES = Object.freeze(["easy", "medium", "hard", "insane"]);

/**
 * Tokens that should be upper-cased when prettifying a folder name into a
 * title (security acronyms read wrong in Title Case otherwise).
 */
const ACRONYMS = new Set([
  "xss", "csrf", "ssrf", "rce", "idor", "sqli", "sql", "xxe", "lfi", "rfi",
  "ssti", "jwt", "api", "url", "dom", "html", "css", "oauth", "sso", "mfa",
  "2fa", "dos", "ddos", "cve", "poc", "waf", "tls", "ssl", "ip", "id", "ui",
]);

const KNOWN_CATEGORY_KEYWORDS = new Map([
  ["xss", "XSS"],
  ["html-injection", "HTML Injection"],
  ["open-redirect", "Open Redirect"],
  ["account-takeover", "Account Takeover"],
  ["csrf", "CSRF"],
  ["ssrf", "SSRF"],
  ["idor", "IDOR"],
  ["auth", "Authentication"],
  ["authentication", "Authentication"],
  ["web-security", "Web Security"],
]);

/**
 * Read and JSON-parse a file, returning null on any failure.
 * @param {string} filePath
 * @returns {Record<string, unknown> | null}
 */
function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(readTextFile(filePath) || "null");
  } catch {
    return null;
  }
}

/**
 * Read a text file as UTF-8, transparently handling a UTF-16 LE/BE BOM
 * (some READMEs in this repo are saved as UTF-16).
 * @param {string} filePath
 * @returns {string}
 */
function readTextFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  const buffer = fs.readFileSync(filePath);
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString("utf16le").replace(/^﻿/, "");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return Buffer.from(buffer).swap16().toString("utf16le").replace(/^﻿/, "");
  }
  return buffer.toString("utf8").replace(/^﻿/, "");
}

/**
 * Slugify a string into a safe id fragment.
 * @param {string} value
 * @returns {string}
 */
function slugify(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Turn a folder name like "bb-001-dom-xss-open-redirect-lab" into a readable
 * title like "DOM XSS Open Redirect".
 * @param {string} folderName
 * @returns {string}
 */
function prettifyTitle(folderName) {
  const cleaned = folderName
    .replace(/^bb-\d+-/i, "")
    .replace(/-lab$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();

  if (!cleaned) {
    return folderName;
  }

  return cleaned
    .split(/\s+/)
    .map((word) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) {
        return lower.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Coerce an unknown value into a clean array of non-empty strings.
 * @param {unknown} value
 * @returns {string[]}
 */
function coerceStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

/**
 * Normalize hints into a consistent `{ text }` shape.
 * @param {unknown} value
 * @returns {Array<{ text: string }>}
 */
function coerceHints(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (typeof item === "string") {
        return { text: item.trim() };
      }
      if (item && typeof item === "object" && typeof item.text === "string") {
        return { text: item.text.trim() };
      }
      return null;
    })
    .filter((item) => item && item.text.length > 0);
}

/**
 * Normalize reference links, keeping only safe http(s) URLs.
 * @param {unknown} value
 * @returns {Array<{ label: string, url: string }>}
 */
function coerceLinks(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const label = typeof item.label === "string" ? item.label.trim() : "";
      const url = typeof item.url === "string" ? item.url.trim() : "";
      if (!label || !/^https?:\/\//i.test(url)) {
        return null;
      }
      return { label, url };
    })
    .filter(Boolean);
}

/**
 * Derive categories from package.json keywords when not explicitly provided.
 * @param {string[]} keywords
 * @returns {string[]}
 */
function categoriesFromKeywords(keywords) {
  const result = new Set();
  for (const keyword of keywords) {
    const mapped = KNOWN_CATEGORY_KEYWORDS.get(keyword.toLowerCase());
    if (mapped) {
      result.add(mapped);
    }
  }
  return [...result];
}

/**
 * Strip a leading H1 ("# Title") from markdown so the brief doesn't duplicate
 * the lab title already shown in the UI.
 * @param {string} markdown
 * @returns {string}
 */
function stripFirstHeading(markdown) {
  return markdown.replace(/^\s*#\s+.*(?:\r?\n)+/, "").trim();
}

/**
 * Extract a one-line summary from README markdown (first real paragraph).
 * @param {string} markdown
 * @returns {string}
 */
function firstParagraph(markdown) {
  const body = stripFirstHeading(markdown);
  for (const block of body.split(/\r?\n\s*\r?\n/)) {
    const line = block.replace(/\s+/g, " ").trim();
    if (line && !line.startsWith("#") && !line.startsWith(">")) {
      return line.length > 220 ? `${line.slice(0, 217)}…` : line;
    }
  }
  return "";
}

/**
 * Build the runtime descriptor, merging explicit manifest runtime with values
 * inferred from package.json.
 * @param {Record<string, unknown>} runtime Raw `runtime` from lab.json.
 * @param {Record<string, unknown> | null} pkg Parsed package.json.
 * @param {string[]} warnings Collector for non-fatal issues.
 * @returns {object}
 */
function buildRuntime(runtime, pkg, warnings) {
  const explicit = runtime && typeof runtime === "object" ? runtime : {};
  const scripts = (pkg && typeof pkg.scripts === "object" && pkg.scripts) || {};
  const main = typeof pkg?.main === "string" ? pkg.main : null;

  let start = typeof explicit.start === "string" ? explicit.start.trim() : "";
  if (!start) {
    if (typeof scripts.start === "string") {
      start = "npm start";
    } else if (main) {
      start = `node ${main}`;
    } else {
      start = "node server.js";
    }
  }

  let install = typeof explicit.install === "string" ? explicit.install.trim() : "";
  if (install === "" && explicit.install !== null) {
    install = pkg ? "npm install" : "";
  }

  const env = {};
  if (explicit.env && typeof explicit.env === "object") {
    for (const [key, val] of Object.entries(explicit.env)) {
      if (typeof val === "string") {
        env[key] = val;
      } else {
        warnings.push(`runtime.env.${key} ignored (must be a string).`);
      }
    }
  }

  const defaultPort =
    Number.isInteger(explicit.defaultPort) && explicit.defaultPort > 0
      ? explicit.defaultPort
      : null;

  return {
    type: explicit.type === "node" || !explicit.type ? "node" : String(explicit.type),
    install: install || null,
    start,
    portEnv: typeof explicit.portEnv === "string" && explicit.portEnv.trim()
      ? explicit.portEnv.trim()
      : "PORT",
    defaultPort,
    readyPath:
      typeof explicit.readyPath === "string" && explicit.readyPath.trim()
        ? normalizeReadyPath(explicit.readyPath.trim())
        : "/",
    cwd: typeof explicit.cwd === "string" && explicit.cwd.trim() ? explicit.cwd.trim() : null,
    env,
  };
}

/**
 * Ensure a readiness path starts with "/" and contains no scheme/host.
 * @param {string} value
 * @returns {string}
 */
function normalizeReadyPath(value) {
  if (/^https?:\/\//i.test(value)) {
    try {
      return new URL(value).pathname || "/";
    } catch {
      return "/";
    }
  }
  return value.startsWith("/") ? value : `/${value}`;
}

/**
 * Build a normalized manifest for a single lab directory.
 * @param {{ dir: string, folderName: string }} input
 * @returns {object} Normalized manifest.
 */
function buildManifest({ dir, folderName }) {
  const warnings = [];
  const manifestPath = path.join(dir, "lab.json");
  const packageJsonPath = path.join(dir, "package.json");
  const readmePath = path.join(dir, "README.md");

  const raw = readJsonFile(manifestPath) || {};
  const hasManifest = fs.existsSync(manifestPath);
  if (hasManifest && Object.keys(raw).length === 0) {
    warnings.push("lab.json exists but could not be parsed; using inferred defaults.");
  }

  const pkg = readJsonFile(packageJsonPath);
  const readme = readTextFile(readmePath);

  const id = typeof raw.id === "string" && raw.id.trim() ? slugify(raw.id) : slugify(folderName);
  const title =
    typeof raw.title === "string" && raw.title.trim()
      ? raw.title.trim()
      : prettifyTitle(folderName);

  const pkgDescription = typeof pkg?.description === "string" ? pkg.description.trim() : "";
  const summary =
    (typeof raw.summary === "string" && raw.summary.trim()) ||
    pkgDescription ||
    firstParagraph(readme) ||
    "";

  let difficulty = "medium";
  if (typeof raw.difficulty === "string") {
    const candidate = raw.difficulty.toLowerCase().trim();
    if (DIFFICULTIES.includes(candidate)) {
      difficulty = candidate;
    } else {
      warnings.push(`Unknown difficulty "${raw.difficulty}"; defaulting to "medium".`);
    }
  }

  const pkgKeywords = coerceStringArray(pkg?.keywords);
  let categories = coerceStringArray(raw.categories);
  if (categories.length === 0) {
    categories = categoriesFromKeywords(pkgKeywords);
  }

  const author =
    (typeof raw.author === "string" && raw.author.trim()) ||
    (typeof pkg?.author === "string" && pkg.author.trim()) ||
    null;

  const briefSource =
    typeof raw.brief === "string" && raw.brief.trim()
      ? raw.brief.trim()
      : stripFirstHeading(readme) || summary;

  return {
    id,
    folderName,
    title,
    summary,
    difficulty,
    categories,
    tags: coerceStringArray(raw.tags),
    vulnType: typeof raw.vulnType === "string" && raw.vulnType.trim() ? raw.vulnType.trim() : null,
    estimatedMinutes:
      Number.isInteger(raw.estimatedMinutes) && raw.estimatedMinutes > 0
        ? raw.estimatedMinutes
        : null,
    author,
    reportRef: typeof raw.reportRef === "string" && raw.reportRef.trim() ? raw.reportRef.trim() : null,
    runtime: buildRuntime(raw.runtime, pkg, warnings),
    brief: briefSource,
    objectives: coerceStringArray(raw.objectives),
    hints: coerceHints(raw.hints),
    solution: typeof raw.solution === "string" && raw.solution.trim() ? raw.solution.trim() : null,
    links: coerceLinks(raw.links),
    hasManifest,
    hasPackageJson: Boolean(pkg),
    source: hasManifest ? (pkg ? "mixed" : "manifest") : "inferred",
    warnings,
    paths: {
      dir,
      manifest: hasManifest ? manifestPath : null,
      packageJson: pkg ? packageJsonPath : null,
      readme: fs.existsSync(readmePath) ? readmePath : null,
    },
  };
}

module.exports = {
  buildManifest,
  // Exported for unit-level reuse / testing.
  prettifyTitle,
  slugify,
  readTextFile,
  DIFFICULTIES,
};
