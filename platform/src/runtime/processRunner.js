"use strict";

/**
 * Low-level process control for labs.
 *
 * Commands (`npm install`, `npm start`, `node src/server.js`, ...) come from a
 * lab's manifest, which is authored alongside the lab code itself — the same
 * trust boundary. They are run through the platform shell so npm scripts work
 * uniformly on Windows and POSIX. Output is streamed line-by-line to a callback.
 */

const { spawn, execFile } = require("node:child_process");

const logger = require("../logger").child("proc");

const IS_WINDOWS = process.platform === "win32";

/**
 * Spawn a shell command. On POSIX the child gets its own process group so the
 * whole tree can be signalled; on Windows the tree is torn down with taskkill.
 * @param {string} command
 * @param {{ cwd: string, env: NodeJS.ProcessEnv }} options
 * @returns {import("node:child_process").ChildProcess}
 */
function spawnShell(command, { cwd, env }) {
  return spawn(command, {
    cwd,
    env,
    shell: true,
    detached: !IS_WINDOWS,
    windowsHide: true,
  });
}

/**
 * Wire a child's stdout/stderr to a line-oriented callback.
 * @param {import("node:child_process").ChildProcess} child
 * @param {(line: string, stream: "stdout" | "stderr") => void} onLog
 */
function pipeLogs(child, onLog) {
  for (const stream of ["stdout", "stderr"]) {
    let buffer = "";
    child[stream]?.setEncoding("utf8");
    child[stream]?.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        onLog(line, stream);
      }
    });
    child[stream]?.on("end", () => {
      if (buffer.trim()) {
        onLog(buffer, stream);
        buffer = "";
      }
    });
  }
}

/**
 * Run a one-shot command (e.g. install) to completion.
 * @param {object} options
 * @param {string} options.command
 * @param {string} options.cwd
 * @param {NodeJS.ProcessEnv} options.env
 * @param {number} options.timeoutMs
 * @param {(line: string, stream: string) => void} options.onLog
 * @returns {Promise<void>} Resolves on exit code 0; rejects otherwise.
 */
function runToCompletion({ command, cwd, env, timeoutMs, onLog }) {
  return new Promise((resolve, reject) => {
    const child = spawnShell(command, { cwd, env });
    pipeLogs(child, onLog);

    const timer = setTimeout(() => {
      onLog(`Timed out after ${Math.round(timeoutMs / 1000)}s — terminating.`, "stderr");
      killTree(child).catch(() => {});
      reject(new Error(`Command timed out: ${command}`));
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command "${command}" exited with ${signal || code}.`));
      }
    });
  });
}

/**
 * Start a long-running command (the lab server).
 * @param {object} options
 * @param {string} options.command
 * @param {string} options.cwd
 * @param {NodeJS.ProcessEnv} options.env
 * @param {(line: string, stream: string) => void} options.onLog
 * @param {(info: { code: number | null, signal: string | null }) => void} options.onExit
 * @returns {import("node:child_process").ChildProcess}
 */
function startLongRunning({ command, cwd, env, onLog, onExit }) {
  const child = spawnShell(command, { cwd, env });
  pipeLogs(child, onLog);
  child.on("exit", (code, signal) => onExit({ code, signal }));
  child.on("error", (error) => onLog(`Process error: ${error.message}`, "stderr"));
  return child;
}

/**
 * Forcibly terminate a child and all of its descendants.
 * @param {import("node:child_process").ChildProcess} child
 * @returns {Promise<void>}
 */
function killTree(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const pid = child.pid;
    if (!pid) {
      resolve();
      return;
    }

    if (IS_WINDOWS) {
      execFile("taskkill", ["/pid", String(pid), "/T", "/F"], (error) => {
        if (error) {
          logger.debug(`taskkill for pid ${pid} reported: ${error.message}`);
        }
        resolve();
      });
      return;
    }

    try {
      // Negative pid targets the whole process group (detached spawn).
      process.kill(-pid, "SIGTERM");
    } catch (error) {
      logger.debug(`SIGTERM for group ${pid} failed: ${error.message}`);
    }

    // Escalate to SIGKILL shortly after if it is still alive.
    const escalate = setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }, 3000);

    child.once("exit", () => {
      clearTimeout(escalate);
      resolve();
    });

    // Safety net: resolve even if the exit event never arrives.
    setTimeout(resolve, 3500);
  });
}

module.exports = { runToCompletion, startLongRunning, killTree };
