const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// In‑memory user store
const users = new Map();

function generateToken(email) {
  const payload = `${email}:${Date.now()}:${Math.random().toString(36)}`;
  return Buffer.from(payload).toString('base64');
}

function verifyToken(token) {
  if (!token) return null;
  try {
    const decoded = Buffer.from(token, 'base64').toString();
    const email = decoded.split(':')[0];
    return users.has(email) ? email : null;
  } catch (e) {
    return null;
  }
}

// Routes
app.get('/', (req, res) => res.redirect('/app/login'));

app.get('/app/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.post('/app/register', (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) return res.status(400).send('All fields required');
  if (users.has(email)) return res.status(409).send('Email exists. <a href="/app/login">Login</a>');
  users.set(email, { email, password, name, campaigns: ['Campaign A', 'Campaign B'], createdAt: new Date() });
  const token = generateToken(email);
  res.cookie('auth-token', token, { httpOnly: false, sameSite: 'lax', maxAge: 3600000 });
  res.redirect('/app/dashboard');
});

app.get('/app/login', (req, res) => {
    const token = req.cookies['auth-token'];
  const email = verifyToken(token);
  if(email)
     res.redirect('/app/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/app/login', (req, res) => {

  const { email, password } = req.body;
  const user = users.get(email);
  if (user && user.password === password) {
    const token = generateToken(email);
    res.cookie('auth-token', token, { httpOnly: false, sameSite: 'lax', maxAge: 3600000 });
    res.redirect('/app/dashboard');
  }
});

app.get('/app/dashboard', (req, res) => {
  const token = req.cookies['auth-token'];
  const email = verifyToken(token);
  if (!email) return res.redirect('/app/login');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/api/user', (req, res) => {
  const token = req.cookies['auth-token'];
  const email = verifyToken(token);
  if (!email) return res.status(401).json({ error: 'Unauthorized' });
  const user = users.get(email);
  res.json({ name: user.name, email: user.email, campaigns: user.campaigns, memberSince: user.createdAt });
});

app.get('/app/logout', (req, res) => {
  res.clearCookie('auth-token');
  res.redirect('/app/login');
});

// Vulnerable endpoint
app.get('/loader', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'loader.html'));
});

app.listen(PORT, () => {
  console.log(`🔥 Lab at http://localhost:${PORT}`);
  console.log(`Register: http://localhost:${PORT}/app/register`);
  console.log(`Vulnerable: http://localhost:${PORT}/loader`);
});