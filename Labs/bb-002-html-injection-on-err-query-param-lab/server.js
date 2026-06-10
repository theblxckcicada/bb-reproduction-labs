const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use(
  express.static(path.join(__dirname, "public"), {
    extensions: ["html"]
  })
);

app.get("/", (_req, res) => {
  res.redirect("/signin");
});

app.post("/signin", (req, res) => {
  const { email, password } = req.body;

  if (email === "admin@clouddesk.local" && password === "CloudDesk#2026") {
    return res.redirect("/dashboard");
  }

  const message = "We couldn't sign you in. Check your email and password, then try again.";
  return res.redirect(`/signin?error=${encodeURIComponent(message)}`);
});

app.post("/recover", (_req, res) => {
  const message = "If the email exists, password recovery instructions will be sent shortly.";
  return res.redirect(`/forgot-password?message=${encodeURIComponent(message)}`);
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "CloudDesk Portal"
  });
});

app.listen(PORT, () => {
  console.log(`CloudDesk Portal running at http://localhost:${PORT}`);
  console.log("");
  console.log("Demo credentials");
  console.log("  Email:    admin@clouddesk.local");
  console.log("  Password: CloudDesk#2026");
});
