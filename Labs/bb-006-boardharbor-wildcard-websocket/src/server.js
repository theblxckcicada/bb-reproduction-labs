"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { WebSocketServer } = require("ws");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number.parseInt(process.env.PORT || "5080", 10);
const BROKER_MODE =
  process.env.BROKER_MODE === "fixed" ? "fixed" : "vulnerable";
const PUBLIC_DIR = path.resolve(__dirname, "../public");
const DATA_FILE = process.env.BOARDHARBOR_DATA_FILE
  ? path.resolve(process.env.BOARDHARBOR_DATA_FILE)
  : path.resolve(__dirname, "../data/db.json");
const NUL = "\u0000";
const PASSWORD_SALT = "boardharbor-local-lab";
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const TOKEN_SECRET = crypto.randomBytes(32);

function hashPassword(password) {
  return crypto.scryptSync(password, PASSWORD_SALT, 32);
}

const users = [
  {
    id: 41001,
    name: "Avery Morgan",
    email: "avery@northwind.test",
    passwordHash: hashPassword("Northwind!2026"),
    role: "VIEWER",
    orgId: 71001,
    org: "Northwind Studio",
  },
  {
    id: 42001,
    name: "Morgan Ellis",
    email: "morgan@contoso.test",
    passwordHash: hashPassword("Contoso!2026"),
    role: "EDITOR",
    orgId: 72002,
    org: "Contoso Workshop",
  },
];
const boards = new Map([
  [
    88001,
    {
      id: 88001,
      orgId: 71001,
      name: "Marketing Calendar",
      description: "Campaign planning and launch dates",
      color: "#2f6fed",
      items: [
        {
          id: 501,
          title: "Finalize autumn campaign brief",
          status: "In progress",
          createdById: 41001,
          createdAt: "2026-09-02T08:30:00.000Z",
        },
      ],
    },
  ],
  [
    99002,
    {
      id: 99002,
      orgId: 72002,
      name: "Product Launch",
      description: "Private launch plan for the Atlas release",
      color: "#7c5ce7",
      items: [
        {
          id: 601,
          title: "Approve launch readiness review",
          status: "Review",
          createdById: 42001,
          createdAt: "2026-09-03T10:15:00.000Z",
        },
      ],
    },
  ],
]);
const sessions = new Map();
const websocketClients = new Set();
let nextUserId = 50000;
let nextOrganizationId = 80000;
let nextBoardId = 100000;

function saveData() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const value = {
    users: users.map((user) => {
      const { accessToken: _legacyToken, ...persistedUser } = user;
      return {
        ...persistedUser,
        passwordHash: user.passwordHash.toString("hex"),
      };
    }),
    boards: [...boards.values()],
  };
  fs.writeFileSync(DATA_FILE, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return;
  const value = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  if (!Array.isArray(value.users) || !Array.isArray(value.boards))
    throw new Error("Invalid BoardHarbor data file");
  users.splice(
    0,
    users.length,
    ...value.users.map((user) => {
      const { accessToken: _legacyToken, ...persistedUser } = user;
      return {
        ...persistedUser,
        passwordHash: Buffer.from(user.passwordHash, "hex"),
      };
    }),
  );
  boards.clear();
  for (const board of value.boards) boards.set(board.id, board);
  nextUserId = Math.max(nextUserId, ...users.map((user) => user.id + 1));
  nextOrganizationId = Math.max(
    nextOrganizationId,
    ...users.map((user) => user.orgId + 1),
  );
  nextBoardId = Math.max(
    nextBoardId,
    ...[...boards.keys()].map((boardId) => boardId + 1),
  );
}

loadData();

function signTokenPart(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/**
 * Issue the short-lived JWT-like bearer used by both REST and STOMP clients.
 */
function issueAccessToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const header = signTokenPart({ alg: "HS256", typ: "JWT" });
  const payload = signTokenPart({
    sub: String(user.id),
    orgId: user.orgId,
    userType: user.role,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_SECONDS,
  });
  const signature = crypto
    .createHmac("sha256", TOKEN_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

/**
 * Validate a bearer token and resolve its subject to the current local user.
 */
function userFromAccessToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const [header, payload, suppliedSignature] = parts;
  const expectedSignature = crypto
    .createHmac("sha256", TOKEN_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (
    supplied.length !== expected.length ||
    !crypto.timingSafeEqual(supplied, expected)
  )
    return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (claims.exp <= Math.floor(Date.now() / 1000)) return null;
    const user = users.find((candidate) => String(candidate.id) === claims.sub);
    if (
      !user ||
      user.orgId !== claims.orgId ||
      user.role !== claims.userType
    )
      return null;
    return user;
  } catch {
    return null;
  }
}

function publicUser(user, includeToken = false) {
  const value = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    orgId: user.orgId,
    org: user.org,
  };
  if (includeToken) value.accessToken = issueAccessToken(user);
  return value;
}

function sendJson(response, status, value, headers = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...headers,
  });
  response.end(body);
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 32_768)
        request.destroy(new Error("Request body too large"));
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function cookies(request) {
  return Object.fromEntries(
    (request.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        return [
          part.slice(0, separator),
          decodeURIComponent(part.slice(separator + 1)),
        ];
      }),
  );
}

function authenticate(request) {
  const bearer = (request.headers.authorization || "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (bearer) return userFromAccessToken(bearer);
  const sessionId = cookies(request).bh_session;
  const userId = sessionId ? sessions.get(sessionId) : null;
  return users.find((user) => user.id === userId) || null;
}

function topicMatches(pattern, topic) {
  const expression = pattern
    .split("/")
    .map((segment) => {
      if (segment === "**") return ".*";
      if (segment === "*") return "[^/]+";
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^${expression}$`).test(topic);
}

function canSubscribeLiteral(user, destination) {
  const boardMatch = /^\/topic\/boards\/(\d+)$/.exec(destination);
  if (boardMatch) {
    const board = boards.get(Number(boardMatch[1]));
    return Boolean(board && board.orgId === user.orgId);
  }
  const organizationMatch =
    /^\/topic\/(?:admin\/(?:organizations|workspaces)|organizations|boardharbor-workspaces)\/(\d+)$/.exec(
      destination,
    );
  if (organizationMatch)
    return Number(organizationMatch[1]) === user.orgId;
  // Vulnerable behavior: a pattern names no concrete protected object, so the
  // interceptor falls through even though the broker expands it later.
  return destination.startsWith("/topic/");
}

function canSubscribeFixed(user, destination) {
  return !destination.includes("*") && canSubscribeLiteral(user, destination);
}

function stompFrame(command, headers = {}, body = "") {
  return `${[command, ...Object.entries(headers).map(([key, value]) => `${key}:${value}`), "", body].join("\n")}${NUL}`;
}

function parseStomp(raw) {
  const [head, ...body] = raw.replace(/\u0000$/, "").split("\n\n");
  const [command, ...lines] = head.split("\n");
  const headers = Object.fromEntries(
    lines.filter(Boolean).map((line) => {
      const separator = line.indexOf(":");
      return separator < 0
        ? [line, ""]
        : [line.slice(0, separator), line.slice(separator + 1)];
    }),
  );
  return { command, headers, body: body.join("\n\n") };
}

function sockSend(socket, frame) {
  if (socket.readyState === socket.OPEN)
    socket.send(`a${JSON.stringify([frame])}`);
}

function publish(destination, payload) {
  const body = JSON.stringify(payload);
  for (const client of websocketClients) {
    for (const subscription of client.subscriptions.values()) {
      if (topicMatches(subscription.destination, destination)) {
        sockSend(
          client.socket,
          stompFrame(
            "MESSAGE",
            {
              destination,
              "content-type": "application/json",
              subscription: subscription.id,
              "message-id": `msg-${crypto.randomUUID()}`,
              "content-length": Buffer.byteLength(body),
            },
            body,
          ),
        );
      }
    }
  }
}

function serveStatic(response, pathname) {
  const fileName = {
    "/": "index.html",
    "/app.js": "app.js",
    "/styles.css": "styles.css",
  }[pathname];
  if (!fileName) return false;
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
  };
  const content = fs.readFileSync(path.join(PUBLIC_DIR, fileName));
  response.writeHead(200, {
    "content-type": types[path.extname(fileName)],
    "content-length": content.length,
  });
  response.end(content);
  return true;
}

async function route(request, response) {
  const url = new URL(
    request.url,
    `http://${request.headers.host || "localhost"}`,
  );
  if (request.method === "GET" && serveStatic(response, url.pathname)) return;
  if (request.method === "GET" && url.pathname === "/api/health")
    return sendJson(response, 200, { status: "ok" });
  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    try {
      const input = await parseBody(request);
      const user = users.find(
        (candidate) =>
          candidate.email.toLowerCase() ===
          String(input.email || "")
            .trim()
            .toLowerCase(),
      );
      const suppliedHash = hashPassword(String(input.password || ""));
      if (!user || !crypto.timingSafeEqual(user.passwordHash, suppliedHash))
        return sendJson(response, 401, {
          error: "Email or password is incorrect",
        });
      const sessionId = crypto.randomBytes(24).toString("base64url");
      sessions.set(sessionId, user.id);
      return sendJson(
        response,
        200,
        { user: publicUser(user, true) },
        {
          "set-cookie": `bh_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/`,
        },
      );
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }
  if (request.method === "POST" && url.pathname === "/api/auth/register") {
    try {
      const input = await parseBody(request);
      const name =
        typeof input.name === "string" ? input.name.trim().slice(0, 80) : "";
      const email =
        typeof input.email === "string"
          ? input.email.trim().toLowerCase().slice(0, 160)
          : "";
      const password = typeof input.password === "string" ? input.password : "";
      const organizationName =
        typeof input.organizationName === "string"
          ? input.organizationName.trim().slice(0, 100)
          : "";
      if (name.length < 2)
        return sendJson(response, 400, { error: "Enter your full name" });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return sendJson(response, 400, { error: "Enter a valid work email" });
      if (password.length < 8)
        return sendJson(response, 400, {
          error: "Password must contain at least 8 characters",
        });
      if (organizationName.length < 2)
        return sendJson(response, 400, { error: "Enter a workspace name" });
      if (users.some((candidate) => candidate.email.toLowerCase() === email))
        return sendJson(response, 409, {
          error: "An account already exists for this email",
        });
      const userId = nextUserId++;
      const organizationId = nextOrganizationId++;
      const boardId = nextBoardId++;
      const user = {
        id: userId,
        name,
        email,
        passwordHash: hashPassword(password),
        role: "OWNER",
        orgId: organizationId,
        org: organizationName,
      };
      users.push(user);
      boards.set(boardId, {
        id: boardId,
        orgId: organizationId,
        name: "Getting started",
        description: "Plan your team's first project",
        color: "#2f6fed",
        items: [],
      });
      saveData();
      const sessionId = crypto.randomBytes(24).toString("base64url");
      sessions.set(sessionId, user.id);
      return sendJson(
        response,
        201,
        { user: publicUser(user, true) },
        {
          "set-cookie": `bh_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/`,
        },
      );
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }
  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    const sessionId = cookies(request).bh_session;
    if (sessionId) sessions.delete(sessionId);
    return sendJson(
      response,
      200,
      { success: true },
      {
        "set-cookie":
          "bh_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
      },
    );
  }
  if (request.method === "GET" && url.pathname === "/api/session") {
    const user = authenticate(request);
    return user
      ? sendJson(response, 200, { user: publicUser(user, true) })
      : sendJson(response, 401, { error: "Authentication required" });
  }
  if (request.method === "GET" && url.pathname === "/api/boards") {
    const user = authenticate(request);
    if (!user)
      return sendJson(response, 401, { error: "Authentication required" });
    return sendJson(response, 200, {
      boards: [...boards.values()].filter(
        (board) => board.orgId === user.orgId,
      ),
    });
  }
  const boardMatch = /^\/api\/boards\/(\d+)$/.exec(url.pathname);
  if (request.method === "GET" && boardMatch) {
    const user = authenticate(request);
    const board = boards.get(Number(boardMatch[1]));
    if (!user)
      return sendJson(response, 401, { error: "Authentication required" });
    if (!board || board.orgId !== user.orgId)
      return sendJson(response, 404, { error: "Board not found" });
    return sendJson(response, 200, board);
  }
  const itemMatch = /^\/api\/boards\/(\d+)\/items$/.exec(url.pathname);
  if (request.method === "POST" && itemMatch) {
    const user = authenticate(request);
    const board = boards.get(Number(itemMatch[1]));
    if (!user)
      return sendJson(response, 401, { error: "Authentication required" });
    if (!board || board.orgId !== user.orgId)
      return sendJson(response, 404, { error: "Board not found" });
    if (!["EDITOR", "OWNER"].includes(user.role))
      return sendJson(response, 403, {
        error: "Your role cannot create items",
      });
    try {
      const input = await parseBody(request);
      const title =
        typeof input.title === "string" ? input.title.trim().slice(0, 120) : "";
      const status = ["To do", "In progress", "Review", "Done"].includes(
        input.status,
      )
        ? input.status
        : "To do";
      if (!title)
        return sendJson(response, 400, { error: "Item title is required" });
      const item = {
        id: Date.now(),
        title,
        status,
        createdById: user.id,
        createdAt: new Date().toISOString(),
      };
      board.items.push(item);
      saveData();
      publish(`/topic/boards/${board.id}`, {
        item,
        boardId: board.id,
        eventType: "BOARD_ITEM_CREATE",
      });
      publish(`/topic/admin/organizations/${board.orgId}`, {
        organizationId: board.orgId,
        actorId: user.id,
        eventType: "ORGANIZATION_ACTIVITY",
      });
      return sendJson(response, 201, item);
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }
  const itemUpdateMatch = /^\/api\/boards\/(\d+)\/items\/(\d+)$/.exec(
    url.pathname,
  );
  if (request.method === "PATCH" && itemUpdateMatch) {
    const user = authenticate(request);
    const board = boards.get(Number(itemUpdateMatch[1]));
    if (!user)
      return sendJson(response, 401, { error: "Authentication required" });
    if (!board || board.orgId !== user.orgId)
      return sendJson(response, 404, { error: "Board not found" });
    if (!["EDITOR", "OWNER"].includes(user.role))
      return sendJson(response, 403, {
        error: "Your role cannot update items",
      });
    const item = board.items.find(
      (candidate) => candidate.id === Number(itemUpdateMatch[2]),
    );
    if (!item) return sendJson(response, 404, { error: "Item not found" });
    try {
      const input = await parseBody(request);
      const title =
        typeof input.title === "string"
          ? input.title.trim().slice(0, 120)
          : item.title;
      const status =
        typeof input.status === "string" ? input.status : item.status;
      if (!title)
        return sendJson(response, 400, { error: "Item title is required" });
      if (!["To do", "In progress", "Review", "Done"].includes(status))
        return sendJson(response, 400, { error: "Select a valid status" });
      item.title = title;
      item.status = status;
      item.updatedById = user.id;
      item.updatedAt = new Date().toISOString();
      saveData();
      publish(`/topic/boards/${board.id}`, {
        item,
        boardId: board.id,
        eventType: "BOARD_ITEM_UPDATE",
      });
      publish(`/topic/admin/organizations/${board.orgId}`, {
        organizationId: board.orgId,
        actorId: user.id,
        eventType: "ORGANIZATION_ACTIVITY",
      });
      return sendJson(response, 200, item);
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }
  sendJson(response, 404, { error: "Not found" });
}

const server = http.createServer((request, response) => {
  route(request, response).catch(() =>
    sendJson(response, 500, { error: "Internal server error" }),
  );
});
const websocketServer = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(
    request.url,
    `http://${request.headers.host || "localhost"}`,
  );
  if (!/^\/websocket\/[^/]+\/[^/]+\/websocket$/.test(url.pathname))
    return socket.destroy();
  const expectedOrigin = `http://${request.headers.host || "localhost"}`;
  if (request.headers.origin !== expectedOrigin) return socket.destroy();
  websocketServer.handleUpgrade(request, socket, head, (websocket) =>
    websocketServer.emit("connection", websocket),
  );
});

websocketServer.on("connection", (socket) => {
  const client = { socket, user: null, subscriptions: new Map() };
  websocketClients.add(client);
  socket.send("o");
  socket.on("close", () => websocketClients.delete(client));
  socket.on("message", (data) => {
    let rawFrames;
    try {
      rawFrames = JSON.parse(data.toString());
    } catch {
      return socket.close(1002, "Invalid SockJS payload");
    }
    if (!Array.isArray(rawFrames))
      return socket.close(1002, "Invalid SockJS payload");
    for (const rawFrame of rawFrames) {
      const frame = parseStomp(rawFrame);
      if (frame.command === "CONNECT") {
        const token = (
          frame.headers.Authorization ||
          frame.headers.authorization ||
          ""
        ).replace(/^Bearer\s+/i, "");
        client.user = userFromAccessToken(token);
        if (!client.user) {
          sockSend(
            socket,
            stompFrame("ERROR", { message: "Access denied" }, "Access denied"),
          );
          return socket.close(1008, "Access denied");
        }
        sockSend(
          socket,
          stompFrame("CONNECTED", {
            version: "1.2",
            "user-name": client.user.id,
            "heart-beat": "0,0",
          }),
        );
      } else if (frame.command === "SUBSCRIBE") {
        if (!client.user) return socket.close(1008, "Connect first");
        const destination = frame.headers.destination || "";
        const authorized =
          BROKER_MODE === "fixed"
            ? canSubscribeFixed(client.user, destination)
            : canSubscribeLiteral(client.user, destination);
        if (!authorized || destination.startsWith("/user/")) {
          sockSend(
            socket,
            stompFrame("ERROR", { message: "Access denied" }, "Access denied"),
          );
          return socket.close(1008, "Access denied");
        }
        const id = frame.headers.id || "sub-0";
        client.subscriptions.set(id, { id, destination });
        if (frame.headers.receipt)
          sockSend(
            socket,
            stompFrame("RECEIPT", { "receipt-id": frame.headers.receipt }),
          );
      }
    }
  });
});

if (require.main === module)
  server.listen(PORT, HOST, () =>
    console.log(`BoardHarbor listening on http://${HOST}:${PORT}`),
  );

module.exports = {
  server,
  boards,
  topicMatches,
  canSubscribeLiteral,
  canSubscribeFixed,
  issueAccessToken,
  userFromAccessToken,
  stompFrame,
  parseStomp,
};
