"use strict";

/**
 * Cross-platform syntax gate: runs `node --check` over every .js file under
 * src/ and scripts/. Exits non-zero on the first syntax error so it can be
 * wired into CI or a pre-commit hook. Pure stdlib — no dependencies.
 */

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const TARGET_DIRS = ["src", "scripts"];

/**
 * Recursively collect .js files under a directory.
 * @param {string} dir
 * @returns {string[]}
 */
function collectJsFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  /** @type {string[]} */
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(full);
    }
  }
  return files;
}

function main() {
  const files = TARGET_DIRS.flatMap((d) => collectJsFiles(path.join(ROOT, d)));
  let failures = 0;

  for (const file of files) {
    try {
      execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    } catch (error) {
      failures += 1;
      const detail = error.stderr ? error.stderr.toString() : error.message;
      process.stderr.write(`✗ ${path.relative(ROOT, file)}\n${detail}\n`);
    }
  }

  if (failures > 0) {
    process.stderr.write(`\n${failures} file(s) failed the syntax check.\n`);
    process.exit(1);
  }

  process.stdout.write(`✓ ${files.length} file(s) passed node --check.\n`);
}

main();
