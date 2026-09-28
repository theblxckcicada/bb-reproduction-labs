"use strict";

const crypto = require("node:crypto");
const path = require("node:path");

const express = require("express");

const { createTokenService, hashPassword, verifyPassword } = require("./security");

const DEFAULT_PORT = 5090;
const WORKSPACE_ID = "ws_northstar_01";
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");
const URL_FIELDS = ["title_link", "author_link", "thumb_url", "footer_icon"];

const SEEDED_USERS = Object.freeze([
  Object.freeze({
    id: "usr_owner_01",
    workspaceId: WORKSPACE_ID,
    email: "olivia@northstar.test",
    password: "owner-demo-2026",
    name: "Olivia Chen",
    title: "Workspace owner",
    role: "OWNER",
    initials: "OC",
    color: "#6d5ce7",
  }),
  Object.freeze({
    id: "usr_member_02",
    workspaceId: WORKSPACE_ID,
    email: "maya@northstar.test",
    password: "member-demo-2026",
    name: "Maya Patel",
    title: "Product designer",
    role: "MEMBER",
    initials: "MP",
    color: "#e86f51",
  }),
  Object.freeze({
    id: "usr_guest_03",
    workspaceId: WORKSPACE_ID,
    email: "eli@agency.test",
    password: "guest-demo-2026",
    name: "Eli Brooks",
    title: "External collaborator",
    role: "GUEST",
    initials: "EB",
    color: "#2ba8a0",
  }),
]);

const CHANNELS = Object.freeze([
  Object.freeze({ id: "ch_general", name: "general", topic: "Company-wide announcements and work-based matters" }),
  Object.freeze({ id: "ch_launch", name: "launch-room", topic: "Coordinate the Atlas launch" }),
  Object.freeze({ id: "ch_design", name: "design-critique", topic: "Weekly product design reviews" }),
]);

/**
 * Determine whether a URL uses a scheme accepted by product content.
 * @param {unknown} value Candidate URL.
 * @returns {boolean}
 */
function isAllowedUrl(value) {
  if (typeof value !== "string" || value.length > 4096) {
    return false;
  }
  try {
    return new Set(["http:", "https:", "mailto:"]).has(new URL(value).protocol);
  } catch {
    return false;
  }
}

/**
 * Convert message markup into safe text/link segments.
 * @param {string} text Message text.
 * @returns {Array<{ type: "text" | "link", text: string, url?: string }>}
 */
function parseMessageText(text) {
  const source = typeof text === "string" ? text.slice(0, 12000) : "";
  const segments = [];
  const tokenPattern = /<([^>]+)>/g;
  let cursor = 0;
  let match;

  while ((match = tokenPattern.exec(source)) !== null) {
    if (match.index > cursor) {
      segments.push({ type: "text", text: source.slice(cursor, match.index) });
    }
    const [target, label] = match[1].split("|", 2);
    if (isAllowedUrl(target)) {
      segments.push({ type: "link", text: label || target, url: target });
    } else {
      segments.push({ type: "text", text: match[0] });
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < source.length) {
    segments.push({ type: "text", text: source.slice(cursor) });
  }
  return segments.length ? segments : [{ type: "text", text: source }];
}

/**
 * Copy block content while stripping unsafe button URLs.
 * @param {unknown} blocks Untrusted message blocks.
 * @returns {object[]}
 */
function sanitizeBlocks(blocks) {
  if (!Array.isArray(blocks)) {
    return [];
  }
  return blocks.slice(0, 8).map((block) => ({
    type: typeof block?.type === "string" ? block.type : "section",
    elements: Array.isArray(block?.elements)
      ? block.elements.slice(0, 12).map((element) => {
          const clean = {
            type: typeof element?.type === "string" ? element.type : "text",
            text: typeof element?.text === "string" ? element.text.slice(0, 500) : "",
          };
          if (isAllowedUrl(element?.url)) {
            clean.url = element.url;
          }
          return clean;
        })
      : [],
  }));
}

/**
 * Construct fresh in-memory state for one lab process or test.
 * @returns {object}
 */
function createState() {
  const now = Date.now();
  return {
    users: SEEDED_USERS.map((user) => {
      const { password, ...profile } = user;
      return { ...profile, passwordHash: hashPassword(password) };
    }),
    webhooks: [],
    collectorChunks: new Map(),
    messages: [
      {
        id: "msg_seed_01",
        channelId: "ch_general",
        author: { name: "Olivia Chen", initials: "OC", color: "#6d5ce7", kind: "user" },
        createdAt: now - 43 * 60 * 1000,
        text: "Morning everyone — the Atlas launch brief is ready for final comments.",
        renderedText: [{ type: "text", text: "Morning everyone — the Atlas launch brief is ready for final comments." }],
        attachments: [],
        blocks: [],
      },
      {
        id: "msg_seed_02",
        channelId: "ch_general",
        author: { name: "Maya Patel", initials: "MP", color: "#e86f51", kind: "user" },
        createdAt: now - 31 * 60 * 1000,
        text: "The onboarding screens are in review. I added the empty and loading states too.",
        renderedText: [{ type: "text", text: "The onboarding screens are in review. I added the empty and loading states too." }],
        attachments: [],
        blocks: [],
      },
      {
        id: "msg_seed_03",
        channelId: "ch_launch",
        author: { name: "Launch Calendar", initials: "LC", color: "#3273dc", kind: "app" },
        createdAt: now - 18 * 60 * 1000,
        text: "Launch readiness sync starts at 14:30.",
        renderedText: [{ type: "text", text: "Launch readiness sync starts at 14:30." }],
        attachments: [
          {
            title: "Atlas launch readiness",
            title_link: "https://meet.pulsewire.test/qtr-sync-now",
            text: "9 participants · 30 minutes",
          },
        ],
        blocks: [],
      },
    ],
  };
}

/**
 * Create the Pulsewire lab application.
 * @param {{ linkPolicy?: "vulnerable" | "fixed", tokenSecret?: string }} [options]
 * @returns {import("express").Express}
 */
function createApp(options = {}) {
  const linkPolicy = options.linkPolicy || process.env.LINK_POLICY || "vulnerable";
  if (!new Set(["vulnerable", "fixed"]).has(linkPolicy)) {
    throw new Error('LINK_POLICY must be either "vulnerable" or "fixed".');
  }

  const app = express();
  const state = createState();
  const tokens = createTokenService(options.tokenSecret);
  const invalidAccountHash = hashPassword("invalid-account-password");

  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    // No script-src CSP is intentional: it preserves the vulnerable browser
    // precondition from the source finding for this isolated training app.
    next();
  });
  app.use(express.json({ limit: "128kb" }));

  /** @param {string} id User id. */
  const userById = (id) => state.users.find((user) => user.id === id);

  /** Express middleware that requires a valid access token. */
  function requireAuth(req, res, next) {
    const authHeader = req.get("AuthToken") || req.get("Authorization") || "";
    const serialized = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    try {
      const claims = tokens.verify(serialized, "access");
      const user = userById(claims.sub);
      if (!user || claims.workspace !== WORKSPACE_ID) {
        throw new Error("The account no longer exists.");
      }
      req.user = user;
      next();
    } catch (error) {
      res.status(401).json({ message: error.message, code: 401000 });
    }
  }

  /** Ensure a route workspace is the seeded workspace. */
  function requireWorkspace(req, res, next) {
    if (req.params.workspaceId !== WORKSPACE_ID) {
      return res.status(404).json({ message: "Workspace not found.", code: 404001 });
    }
    next();
  }

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", product: "Pulsewire", linkPolicy });
  });

  app.get("/api/config", (req, res) => {
    res.json({
      product: "Pulsewire",
      workspaceId: WORKSPACE_ID,
      linkPolicy,
      meetingHost: "https://meet.pulsewire.test",
      memberCount: 15 + state.users.length,
    });
  });

  app.post("/api/auth/login", (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const user = state.users.find((candidate) => candidate.email === email);
    const passwordMatches = verifyPassword(password, user?.passwordHash || invalidAccountHash);
    if (!user || !passwordMatches) {
      return res.status(401).json({ message: "Email or password is incorrect.", code: 401001 });
    }
    res.json({
      ...tokens.bundleFor(user),
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      workspaceId: WORKSPACE_ID,
    });
  });

  app.post("/api/auth/register", (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim().replace(/\s+/g, " ") : "";
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (name.length < 2 || name.length > 60) {
      return res.status(400).json({ message: "Enter a name between 2 and 60 characters.", code: 400101 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return res.status(400).json({ message: "Enter a valid work email address.", code: 400102 });
    }
    if (password.length < 10 || password.length > 128) {
      return res.status(400).json({ message: "Password must be between 10 and 128 characters.", code: 400103 });
    }
    if (state.users.some((candidate) => candidate.email === email)) {
      return res.status(409).json({ message: "An account with that email already exists.", code: 409101 });
    }

    const words = name.split(" ").filter(Boolean);
    const initials = words
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase();
    const colors = ["#3273dc", "#8b5cc7", "#d46545", "#238b82", "#b27622"];
    const user = {
      id: `usr_${crypto.randomUUID()}`,
      workspaceId: WORKSPACE_ID,
      email,
      passwordHash: hashPassword(password),
      name,
      title: "Workspace member",
      role: "MEMBER",
      initials,
      color: colors[state.users.length % colors.length],
    };
    state.users.push(user);

    res.status(201).json({
      ...tokens.bundleFor(user),
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      workspaceId: WORKSPACE_ID,
    });
  });

  app.post("/api/workspaces/:workspaceId/refresh", requireWorkspace, (req, res) => {
    try {
      const claims = tokens.verify(req.body?.refreshToken, "refresh");
      const user = userById(claims.sub);
      if (!user || claims.workspace !== WORKSPACE_ID) {
        throw new Error("Refresh token account is unavailable.");
      }
      res.json({ ...tokens.bundleFor(user), user: { id: user.id, email: user.email, name: user.name, role: user.role } });
    } catch (error) {
      res.status(401).json({ message: error.message, code: 401002 });
    }
  });

  app.get("/api/me", requireAuth, (req, res) => {
    const { passwordHash, ...safeUser } = req.user;
    res.json({
      user: safeUser,
      workspace: {
        id: WORKSPACE_ID,
        name: "Northstar Labs",
        plan: "Business trial",
        members: 15 + state.users.length,
      },
    });
  });

  app.get("/api/channels", requireAuth, (req, res) => {
    res.json({ channels: CHANNELS });
  });

  app.get("/api/channels/:channelId/messages", requireAuth, (req, res) => {
    if (!CHANNELS.some((channel) => channel.id === req.params.channelId)) {
      return res.status(404).json({ message: "Channel not found.", code: 404002 });
    }
    const messages = state.messages.filter((message) => message.channelId === req.params.channelId);
    res.json({ messages });
  });

  app.post("/api/channels/:channelId/messages", requireAuth, (req, res) => {
    if (!CHANNELS.some((channel) => channel.id === req.params.channelId)) {
      return res.status(404).json({ message: "Channel not found.", code: 404002 });
    }
    const text = typeof req.body?.text === "string" ? req.body.text.trim().slice(0, 12000) : "";
    if (!text) {
      return res.status(400).json({ message: "Message text is required.", code: 400001 });
    }
    const message = {
      id: `msg_${crypto.randomUUID()}`,
      channelId: req.params.channelId,
      author: { name: req.user.name, initials: req.user.initials, color: req.user.color, kind: "user" },
      createdAt: Date.now(),
      text,
      renderedText: parseMessageText(text),
      attachments: [],
      blocks: [],
    };
    state.messages.push(message);
    res.status(201).json({ message });
  });

  app.get(
    "/api/workspaces/:workspaceId/incoming-webhooks",
    requireAuth,
    requireWorkspace,
    (req, res) => {
      res.json({
        webhooks: state.webhooks
          .filter((webhook) => webhook.workspaceUserId === req.user.id)
          .map(({ token, ...webhook }) => ({ ...webhook, tokenPreview: `${token.slice(0, 5)}…${token.slice(-4)}` })),
      });
    }
  );

  app.post(
    "/api/workspaces/:workspaceId/incoming-webhooks",
    requireAuth,
    requireWorkspace,
    (req, res) => {
      if (req.user.role === "GUEST") {
        return res.status(403).json({ message: "Guests cannot create incoming webhooks.", code: 403000 });
      }
      const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 64) : "";
      const channelId = typeof req.body?.channelId === "string" ? req.body.channelId : "";
      if (!name || !CHANNELS.some((channel) => channel.id === channelId)) {
        return res.status(400).json({ message: "A name and valid channel are required.", code: 400002 });
      }
      const token = crypto.randomBytes(18).toString("base64url");
      const postPath = `/api/hooks/${token}/messages`;
      const webhook = {
        id: `hook_${crypto.randomUUID()}`,
        name,
        channelId,
        workspaceId: WORKSPACE_ID,
        workspaceUserId: req.user.id,
        createdBy: req.user.name,
        createdAt: Date.now(),
        token,
        postPath,
      };
      state.webhooks.push(webhook);
      res.status(201).json({ ...webhook, url: `${req.protocol}://${req.get("host")}${postPath}` });
    }
  );

  app.post("/api/apps/install", requireAuth, (req, res) => {
    if (req.user.role !== "OWNER") {
      return res.status(403).json({ message: "Only owners can install applications.", code: 403210 });
    }
    res.json({ status: "approved" });
  });

  app.post("/api/hooks/:token/messages", (req, res) => {
    const webhook = state.webhooks.find((candidate) => candidate.token === req.params.token);
    if (!webhook) {
      return res.status(404).json({ message: "Webhook not found.", code: 404003 });
    }
    const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments.slice(0, 4) : [];
    if (linkPolicy === "fixed") {
      const unsafeField = attachments.some((attachment) =>
        URL_FIELDS.some((field) => attachment?.[field] && !isAllowedUrl(attachment[field]))
      );
      if (unsafeField) {
        return res.status(400).json({ message: "Attachment links must use http, https, or mailto.", code: 400410 });
      }
    }

    const storedAttachments = attachments.map((attachment) => {
      const stored = {
        title: typeof attachment?.title === "string" ? attachment.title.slice(0, 160) : "Untitled attachment",
        text: typeof attachment?.text === "string" ? attachment.text.slice(0, 1000) : "",
      };
      for (const field of URL_FIELDS) {
        if (typeof attachment?.[field] === "string") {
          // Vulnerable mode intentionally persists these fields verbatim.
          stored[field] = attachment[field].slice(0, 4096);
        }
      }
      return stored;
    });

    const text = typeof req.body?.text === "string" ? req.body.text.slice(0, 12000) : "";
    state.messages.push({
      id: `msg_${crypto.randomUUID()}`,
      channelId: webhook.channelId,
      author: { name: webhook.name, initials: "PW", color: "#3273dc", kind: "app" },
      createdAt: Date.now(),
      text,
      renderedText: parseMessageText(text),
      attachments: storedAttachments,
      blocks: sanitizeBlocks(req.body?.blocks),
    });
    res.type("text/plain").send("ok");
  });

  app.get(
    "/api/workspaces/:workspaceId/payments/customer",
    requireAuth,
    requireWorkspace,
    (req, res) => {
      if (req.user.role !== "OWNER") {
        return res.status(403).json({ message: "You cannot access this resource.", code: 403000 });
      }
      res.json({
        basicInfo: { workspace: "Northstar Labs", plan: "Business trial", seats: 18 },
        billingInfo: { status: "trial", renewalDate: "2026-10-15", paymentMethod: null },
        invoiceInfo: { currency: "USD", nextInvoice: 0 },
      });
    }
  );

  app.get("/collector/p:part/:chunk", (req, res) => {
    const part = Number(req.params.part);
    const chunk = req.params.chunk;
    if (!Number.isInteger(part) || part < 0 || part > 3 || !/^[A-Za-z0-9._~-]{1,512}$/.test(chunk)) {
      return res.status(400).json({ message: "Invalid collector chunk." });
    }
    state.collectorChunks.set(part, { value: chunk, receivedAt: Date.now() });
    res.status(204).end();
  });

  app.get("/collector/capture", (req, res) => {
    const ready = [0, 1, 2, 3].every((part) => state.collectorChunks.has(part));
    const assembled = ready
      ? [0, 1, 2, 3].map((part) => state.collectorChunks.get(part).value).join("")
      : null;
    res.json({
      ready,
      receivedParts: [...state.collectorChunks.keys()].sort(),
      assembled,
      length: assembled?.length || 0,
    });
  });

  app.delete("/collector/capture", (req, res) => {
    state.collectorChunks.clear();
    res.status(204).end();
  });

  app.use(express.static(PUBLIC_DIR, { index: "index.html" }));
  app.get(/.*/, (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

  app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && "body" in error) {
      return res.status(400).json({ message: "Request body is not valid JSON.", code: 400000 });
    }
    console.error(error);
    res.status(500).json({ message: "Internal server error.", code: 500000 });
  });

  return app;
}

/** Start the standalone lab server. */
function start() {
  const port = Number(process.env.PORT || DEFAULT_PORT);
  const host = process.env.HOST || "127.0.0.1";
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${process.env.PORT}`);
  }
  const app = createApp();
  const server = app.listen(port, host, () => {
    console.log(`Pulsewire lab listening on http://${host}:${port}`);
    console.log(`Attachment link policy: ${process.env.LINK_POLICY || "vulnerable"}`);
  });
  return server;
}

if (require.main === module) {
  start();
}

module.exports = {
  CHANNELS,
  SEEDED_USERS,
  WORKSPACE_ID,
  createApp,
  isAllowedUrl,
  parseMessageText,
  sanitizeBlocks,
  start,
};
