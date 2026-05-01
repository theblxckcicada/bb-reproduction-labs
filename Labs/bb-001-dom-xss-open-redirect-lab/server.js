const express = require("express");
const session = require("express-session");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    name: "auth-token",
    secret: process.env.SESSION_SECRET || "change-this-secret-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: false,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 4
    }
  })
);

app.use(express.static(path.join(__dirname, "public")));

const users = new Map();
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

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
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
        total: "$189.99",
        items: "Pulse Audio, Travel Case",
        eta: "Expected delivery by 17 Apr"
      },
      {
        id: "NS-20372",
        date: "09 Apr 2026",
        status: "Shipped",
        statusClass: "status-shipped",
        total: "$94.99",
        items: "Northline Carry",
        eta: "In transit"
      },
      {
        id: "NS-20193",
        date: "27 Mar 2026",
        status: "Delivered",
        statusClass: "status-delivered",
        total: "$129.99",
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
      { name: "Drift Fleece", price: "$72.00" },
      { name: "Pulse Audio Stand", price: "$39.99" },
      { name: "Northline Tech Pouch", price: "$24.99" }
    ]
  };
}

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

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  if (users.has(username.toLowerCase())) {
    return res.status(409).json({ error: "That username already exists." });
  }

  users.set(username.toLowerCase(), {
    username,
    passwordHash: hashPassword(password)
  });

  req.session.user = { username };
  return res.json({ ok: true, user: req.session.user });
});

app.post("/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const user = users.get(username.toLowerCase());

  if (!user || user.passwordHash !== hashPassword(password)) {
    return res.status(401).json({ error: "Invalid username or password." });
  }

  req.session.user = { username: user.username };
  return res.json({ ok: true, user: req.session.user });
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("auth-token");
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
