"use strict";

/**
 * Ovawatch Labs — control-plane HTTP server.
 *
 * Serves the catalog/console SPA and the lab orchestration API. Binds to
 * localhost by default; the deliberately-vulnerable labs it launches must not
 * be exposed on a routable interface.
 */

const path = require("node:path");
const express = require("express");

const config = require("./config");
const logger = require("./logger").child("server");
const labsRouter = require("./routes/labsRouter");
const progressRouter = require("./routes/progressRouter");
const manager = require("./runtime/instanceManager");
const registry = require("./labs/registry");
const progress = require("./store/progressStore");

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", "loopback");

// Security headers. The SPA uses only same-origin assets; lab apps are opened
// in their own tabs (not framed), so the policy can be strict.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ")
  );
  next();
});

app.use(express.json({ limit: "64kb" }));

// Health check.
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    brand: config.brand,
    labs: registry.getAll().length,
    active: manager.listActive().length,
    uptimeSec: Math.round(process.uptime()),
  });
});

// API.
app.use("/api", labsRouter);
app.use("/api", progressRouter);

// Unknown API routes → JSON 404 (before the SPA fallback).
app.use("/api", (req, res) => {
  res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` });
});

// Static SPA assets.
app.use(express.static(config.publicDir, { index: "index.html", extensions: ["html"] }));

// SPA fallback: any non-API GET serves index.html so client routing works.
app.get(/.*/, (req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api/")) {
    return next();
  }
  res.sendFile(path.join(config.publicDir, "index.html"));
});

// Central error handler.
// eslint-disable-next-line no-unused-vars -- Express needs the 4-arg signature.
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    logger.error(`Unhandled error on ${req.method} ${req.originalUrl}: ${err.stack || err.message}`);
  }
  const message = status < 500 || err.expose ? err.message : "Internal server error.";
  res.status(status).json({ error: message });
});

/**
 * Boot the server: load progress, prime the registry, start listening.
 */
function start() {
  progress.load();
  registry.refresh();

  const server = app.listen(config.port, config.host, () => {
    logger.info(`${config.brand} running at http://${config.host}:${config.port}`);
    logger.info(`Serving labs from ${config.labsDir}`);
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      logger.error(`Port ${config.port} is already in use. Set PORT in .env to a free port.`);
    } else {
      logger.error(`Server error: ${error.message}`);
    }
    process.exit(1);
  });

  registerShutdown(server);
  return server;
}

/**
 * Wire graceful shutdown: stop all labs, close the server, then exit.
 * @param {import("node:http").Server} server
 */
function registerShutdown(server) {
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info(`Received ${signal}. Stopping ${manager.listActive().length} lab(s)…`);

    const force = setTimeout(() => {
      logger.warn("Forced exit after shutdown timeout.");
      process.exit(1);
    }, 10000);
    force.unref?.();

    try {
      await manager.stopAll();
      await new Promise((resolve) => server.close(resolve));
      logger.info("Shutdown complete.");
      process.exit(0);
    } catch (error) {
      logger.error(`Error during shutdown: ${error.message}`);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("uncaughtException", (error) => {
    logger.error(`Uncaught exception: ${error.stack || error.message}`);
    shutdown("uncaughtException");
  });
  process.on("unhandledRejection", (reason) => {
    logger.error(`Unhandled rejection: ${reason}`);
  });
}

if (require.main === module) {
  start();
}

module.exports = { app, start };
