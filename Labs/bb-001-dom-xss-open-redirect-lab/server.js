const express = require("express");
const session = require("express-session");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === "production";

const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 4; // 4 hours
const REMEMBER_ME_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const USER_STORE_PATH = path.join(__dirname, "user-store.json");

const products = [
  {
    id: 1,
    name: "Aster Runner",
    price: 129.99,
    description: "Lightweight everyday trainers finished with responsive foam cushioning.",
    emoji: "👟",
    category: "Footwear"
  },
  {
    id: 2,
    name: "Northline Carry",
    price: 94.99,
    description: "Structured daypack with padded laptop storage and travel-ready organization.",
    emoji: "🎒",
    category: "Travel"
  },
  {
    id: 3,
    name: "Drift Fleece",
    price: 72.0,
    description: "Soft heavyweight layer cut for cooler evenings and all-day comfort.",
    emoji: "🧥",
    category: "Apparel"
  },
  {
    id: 4,
    name: "Pulse Audio",
    price: 159.99,
    description: "Wireless over-ear headphones built for long sessions and clean sound.",
    emoji: "🎧",
    category: "Audio"
  }
];

function loadUsers() {
  try {
    if (!fs.existsSync(USER_STORE_PATH)) {
      return new Map();
    }

    const raw = fs.readFileSync(USER_STORE_PATH, "utf8");
    const records = JSON.parse(raw);

    return new Map(
      Object.entries(records).map(([key, value]) => [key, value])
    );
  } catch (error) {
    console.warn("Could not load user-store.json. Starting with an empty user store.", error.message);
    return new Map();
  }
}

const users = loadUsers();

function saveUsers() {
  const records = Object.fromEntries(users.entries());
  fs.writeFileSync(USER_STORE_PATH, JSON.stringify(records, null, 2));
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) {
    return {};
  }

  return header.split(";").reduce((cookies, item) => {
    const separatorIndex = item.indexOf("=");
    if (separatorIndex === -1) {
      return cookies;
    }

    const key = item.slice(0, separatorIndex).trim();
    const value = item.slice(separatorIndex + 1).trim();

    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }

    return cookies;
  }, {});
}

function getRememberCookieOptions(maxAge) {
  return {
    httpOnly: false,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    maxAge
  };
}

function clearRememberCookie(res) {
  res.clearCookie("remember-token", {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/"
  });
}

function wantsPersistentLogin(value) {
  return value === true || value === "true" || value === "on" || value === "1";
}

function startAuthenticatedSession(req, res, user, rememberMe) {
  req.session.user = { username: user.username };
  req.session.cookie.maxAge = rememberMe ? REMEMBER_ME_MAX_AGE_MS : SESSION_MAX_AGE_MS;

  if (!rememberMe) {
    user.rememberTokenHash = null;
    saveUsers();
    clearRememberCookie(res);
    return;
  }

  const rememberToken = crypto.randomBytes(32).toString("hex");
  user.rememberTokenHash = hashToken(rememberToken);
  saveUsers();

  res.cookie("remember-token", rememberToken, getRememberCookieOptions(REMEMBER_ME_MAX_AGE_MS));
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login.html");
  }
  next();
}

function getInitials(value) {
  return String(value || "NS")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0].toUpperCase())
    .join("") || "NS";
}

function buildAccountOverview(username) {
  const joined = "January 2026";
  return {
    profile: {
      fullName: username,
      email: `${username.toLowerCase().replace(/\s+/g, ".")}@northstar.store`,
      membership: "Northstar Plus",
      initials: getInitials(username),
      joined
    },
    stats: {
      activeOrders: 2,
      savedItems: 14,
      loyaltyPoints: 2480,
      rewardsTier: "Gold"
    },
    orders: [
      {
        id: "NS-20418",
        date: "14 Apr 2026",
        status: "Processing",
        statusClass: "status-processing",
        total: "R189.99",
        items: "Pulse Audio, Travel Case",
        eta: "Expected delivery by 17 Apr"
      },
      {
        id: "NS-20372",
        date: "09 Apr 2026",
        status: "Shipped",
        statusClass: "status-shipped",
        total: "R94.99",
        items: "Northline Carry",
        eta: "In transit"
      },
      {
        id: "NS-20193",
        date: "27 Mar 2026",
        status: "Delivered",
        statusClass: "status-delivered",
        total: "R129.99",
        items: "Aster Runner",
        eta: "Delivered to residence"
      }
    ],
    addresses: [
      {
        label: "Primary delivery",
        lines: ["145 Riverview Lane", "Pretoria, Gauteng", "South Africa"]
      },
      {
        label: "Work address",
        lines: ["Atlas Business Park", "Centurion, Gauteng", "South Africa"]
      }
    ],
    savedItems: [
      { name: "Drift Fleece", price: "R72.00" },
      { name: "Pulse Audio Stand", price: "R39.99" },
      { name: "Northline Tech Pouch", price: "R24.99" }
    ]
  };
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set("trust proxy", 1);

app.use(
  session({
    name: "auth-token",
    secret: process.env.SESSION_SECRET || "change-this-secret-in-production",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: false,
      sameSite: "lax",
      secure: isProduction,
      maxAge: SESSION_MAX_AGE_MS
    }
  })
);

app.use((req, res, next) => {
  if (req.session.user) {
    return next();
  }

  const rememberToken = parseCookies(req)["remember-token"];
  if (!rememberToken) {
    return next();
  }

  const rememberTokenHash = hashToken(rememberToken);
  const rememberedUser = Array.from(users.values()).find(
    user => user.rememberTokenHash === rememberTokenHash
  );

  if (!rememberedUser) {
    clearRememberCookie(res);
    return next();
  }

  req.session.user = { username: rememberedUser.username };
  req.session.cookie.maxAge = REMEMBER_ME_MAX_AGE_MS;
  return next();
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/products", (_req, res) => {
  res.json(products);
});

app.get("/api/session", (req, res) => {
  res.json({
    authenticated: Boolean(req.session.user),
    user: req.session.user || null
  });
});

app.get("/api/account-overview", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Authentication required." });
  }

  return res.json(buildAccountOverview(req.session.user.username));
});

app.post("/register", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const rememberMe = wantsPersistentLogin(req.body.rememberMe ?? true);

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  if (users.has(username.toLowerCase())) {
    return res.status(409).json({ error: "That username already exists." });
  }

  const user = {
    username,
    passwordHash: hashPassword(password),
    rememberTokenHash: null
  };

  users.set(username.toLowerCase(), user);
  startAuthenticatedSession(req, res, user, rememberMe);

  return res.json({ ok: true, user: req.session.user });
});

app.post("/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const rememberMe = wantsPersistentLogin(req.body.rememberMe);
  const user = users.get(username.toLowerCase());

  if (!user || user.passwordHash !== hashPassword(password)) {
    return res.status(401).json({ error: "Invalid username or password." });
  }

  startAuthenticatedSession(req, res, user, rememberMe);
  return res.json({ ok: true, user: req.session.user });
});

app.post("/logout", (req, res) => {
  const username = req.session.user?.username;

  if (username) {
    const user = users.get(username.toLowerCase());
    if (user) {
      user.rememberTokenHash = null;
      saveUsers();
    }
  }

  req.session.destroy(() => {
    res.clearCookie("auth-token");
    clearRememberCookie(res);
    res.json({ ok: true });
  });
});

app.get("/account", requireAuth, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "account.html"));
});

app.get("/loader", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "loader.html"));
});

app.listen(PORT, () => {
  console.log(`Northstar Store is running at http://localhost:${PORT}`);
});
