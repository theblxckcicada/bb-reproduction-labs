const path = require('path');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const helmet = require('helmet');
const morgan = require('morgan');
const config = require('./config');
const db = require('./db');
const auth = require('./auth');

auth.configurePassport();

const app = express();

app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: false
  })
);
app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' }));
app.use(
  session({
    name: 'worknest.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(path.join(__dirname, '..', 'public')));

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'WorkNest' });
});

app.get('/api/me', (req, res) => {
  const user = db.findUserById(req.session.userId);
  res.json({ user: auth.publicUser(user) });
});

app.post(
  '/api/auth/register',
  asyncHandler(async (req, res) => {
    const input = auth.validateRegistration(req.body || {});
    const passwordHash = await auth.hashPassword(input.password);
    const user = db.createUser({
      email: input.email,
      displayName: input.displayName,
      passwordHash,
      providerLinks: {},
      emailVerified: false
    });

    req.session.userId = user.id;
    res.status(201).json({ user: auth.publicUser(user) });
  })
);

app.post(
  '/api/auth/login',
  asyncHandler(async (req, res) => {
    const input = auth.validateLogin(req.body || {});
    const user = db.findUserByEmail(input.email);

    if (!user || !(await auth.verifyPassword(input.password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    req.session.userId = user.id;
    res.json({ user: auth.publicUser(user) });
  })
);

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('worknest.sid');
    res.json({ ok: true });
  });
});

app.get('/auth/google', (req, res, next) => {
  if (!config.google.clientId || !config.google.clientSecret) {
    return res.redirect('/?error=google_not_configured');
  }

  return passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account'
  })(req, res, next);
});

app.get(
  config.google.callbackPath,
  passport.authenticate('google', {
    failureRedirect: '/?error=google_auth_failed'
  }),
  (req, res) => {
    req.session.userId = req.user.id;
    res.redirect('/');
  }
);

app.get('/api/projects', auth.requireAuth, (req, res) => {
  res.json({ projects: db.listProjects(req.user.id) });
});

app.post('/api/projects', auth.requireAuth, (req, res, next) => {
  try {
    const project = db.createProject(req.user.id, req.body || {});
    res.status(201).json({ project });
  } catch (error) {
    next(error);
  }
});

app.post('/api/projects/:projectId/tasks', auth.requireAuth, (req, res, next) => {
  try {
    const task = db.addTask(req.user.id, req.params.projectId, req.body || {});
    res.status(201).json({ task });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/projects/:projectId/tasks/:taskId', auth.requireAuth, (req, res, next) => {
  try {
    const task = db.updateTask(req.user.id, req.params.projectId, req.params.taskId, req.body || {});
    res.json({ task });
  } catch (error) {
    next(error);
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((error, req, res, next) => {
  const statusCode = error.statusCode || 500;
  if (statusCode >= 500) {
    console.error(error);
  }

  res.status(statusCode).json({
    error: statusCode >= 500 ? 'Something went wrong.' : error.message
  });
});

app.listen(config.port, () => {
  console.log(`WorkNest running on ${config.baseUrl}`);
});
