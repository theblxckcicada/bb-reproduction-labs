'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const security = require('./security');

const app = express();

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' }));

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// --------------------------------------------------------------------------
// Public, unauthenticated endpoints
// --------------------------------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'Meridian' });
});

// --------------------------------------------------------------------------
// Console session plane (/app/*)
// --------------------------------------------------------------------------
// This is the AUTHENTICATION surface for the first-party web console. Humans
// sign in here with email + password and receive an httpOnly session cookie; a
// single account can belong to many organizations and must pick which one it is
// working in. API keys are NOT a login mechanism — they are minted from inside
// the console (POST /v1/orgs/:orgId/keys) for terminal/programmatic use only.
// --------------------------------------------------------------------------

const PASSWORD_MIN = 8;

/** Build the canonical "who am I + my orgs + active org" payload for the console. */
function sessionPayload(user, session) {
  const memberships = db.listMembershipsByUser(user.id);
  const active = session.activeOrgId
    ? memberships.find((m) => m.orgId === session.activeOrgId) || null
    : null;
  return {
    user: { id: user.id, name: user.name, email: user.email },
    memberships,
    activeOrgId: active ? active.orgId : null,
    activeOrg: active
      ? { id: active.orgId, name: active.name, slug: active.slug, role: active.role }
      : null,
    role: active ? active.role : null,
    capabilities: active ? auth.capabilitiesFor(active.role) : []
  };
}

// Sign up: create a password-backed account and your first organization (admin).
app.post(
  '/app/signup',
  asyncHandler((req, res) => {
    const { name, email, password, orgName } = req.body || {};
    if (!String(name || '').trim()) {
      return res.status(400).json({ error: 'Your name is required.', code: 'BAD_REQUEST' });
    }
    if (!String(email || '').trim()) {
      return res.status(400).json({ error: 'An email is required.', code: 'BAD_REQUEST' });
    }
    if (String(password || '').length < PASSWORD_MIN) {
      return res.status(400).json({ error: `Password must be at least ${PASSWORD_MIN} characters.`, code: 'BAD_REQUEST' });
    }
    if (!String(orgName || '').trim()) {
      return res.status(400).json({ error: 'An organization name is required.', code: 'BAD_REQUEST' });
    }
    const { user, org } = db.createUserAccount({ name, email, password, orgName });
    const { token, session } = db.createSession(user.id, org.id);
    auth.setSessionCookie(res, token);
    res.status(201).json(sessionPayload(user, session));
  })
);

// Log in: email + password -> session cookie. If the account is in exactly one
// org it is auto-selected; otherwise the console prompts the user to choose.
app.post(
  '/app/login',
  asyncHandler((req, res) => {
    const { email, password } = req.body || {};
    const user = db.findUserByEmail(email);
    if (!user || !security.verifyPassword(password, user.passwordHash)) {
      // Same message for unknown email and wrong password (no account enumeration).
      return res.status(401).json({ error: 'Invalid email or password.', code: 'UNAUTHENTICATED' });
    }
    const memberships = db.listMembershipsByUser(user.id);
    const activeOrgId = memberships.length === 1 ? memberships[0].orgId : null;
    const { token, session } = db.createSession(user.id, activeOrgId);
    auth.setSessionCookie(res, token);
    res.json(sessionPayload(user, session));
  })
);

app.post('/app/logout', (req, res) => {
  const resolved = auth.resolveSession(req);
  if (resolved) db.deleteSession(resolved.token);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

// Current identity, organizations, and which one is selected.
app.get('/app/session', auth.requireSession, (req, res) => {
  res.json(sessionPayload(req.user, req.session));
});

// Choose which organization to work in (must be one the user is a member of).
app.post(
  '/app/session/org',
  auth.requireSession,
  asyncHandler((req, res) => {
    const orgId = String((req.body && req.body.orgId) || '');
    if (!db.findMembership(req.user.id, orgId)) {
      return res.status(403).json({ error: 'You are not a member of that organization.', code: 'FORBIDDEN' });
    }
    const session = db.setSessionActiveOrg(req.sessionToken, orgId);
    res.json(sessionPayload(req.user, session));
  })
);

// Create an additional organization (you become its admin) and switch to it.
app.post(
  '/app/orgs',
  auth.requireSession,
  asyncHandler((req, res) => {
    const orgName = String((req.body && req.body.orgName) || '').trim();
    if (!orgName) {
      return res.status(400).json({ error: 'An organization name is required.', code: 'BAD_REQUEST' });
    }
    const org = db.createOrgForUser(req.user.id, orgName);
    const session = db.setSessionActiveOrg(req.sessionToken, org.id);
    res.status(201).json(sessionPayload(req.user, session));
  })
);

// Public invite lookup (the join page shows the org + role before sign-in).
app.get(
  '/app/invites/:code',
  asyncHandler((req, res) => {
    const invite = db.findInvite(req.params.code);
    if (!invite) {
      return res.status(404).json({ error: 'Invite not found.', code: 'NOT_FOUND' });
    }
    const org = db.findOrg(invite.orgId);
    res.json({
      invite: {
        code: invite.code,
        role: invite.role,
        organization: org ? { id: org.id, name: org.name, slug: org.slug } : null,
        expiresAt: invite.expiresAt,
        used: Boolean(invite.acceptedByUserId),
        expired: new Date(invite.expiresAt).getTime() < Date.now()
      }
    });
  })
);

// Accept an invite as the signed-in user: gain a membership and switch to the org.
app.post(
  '/app/invites/:code/accept',
  auth.requireSession,
  asyncHandler((req, res) => {
    const result = db.acceptInviteForUser(req.params.code, req.user.id);
    const session = db.setSessionActiveOrg(req.sessionToken, result.org.id);
    res.status(201).json(sessionPayload(req.user, session));
  })
);

// --------------------------------------------------------------------------
// Programmatic API (every /v1 route requires an API key OR a console session)
// --------------------------------------------------------------------------

app.use('/v1', auth.authenticate);

app.get('/v1/me', (req, res) => {
  const user = db.findUser(req.auth.userId);
  const org = db.findOrg(req.auth.orgId);
  res.json({
    user: user ? { id: user.id, name: user.name, email: user.email } : null,
    organization: org ? { id: org.id, name: org.name, slug: org.slug } : null,
    role: req.auth.role,
    capabilities: Array.from(auth.ROLE_CAPABILITIES[req.auth.role] || [])
  });
});

const orgScope = ['/v1/orgs/:orgId', auth.requireOrgMember];

app.get(...orgScope, (req, res) => {
  const org = db.findOrg(req.params.orgId);
  res.json({ organization: { id: org.id, name: org.name, slug: org.slug, createdAt: org.createdAt } });
});

app.get('/v1/orgs/:orgId/projects', auth.requireOrgMember, auth.requireCapability('projects:list'), (req, res) => {
  res.json({ projects: db.listProjects(req.params.orgId) });
});

// People in the organization (any member may view the roster).
app.get('/v1/orgs/:orgId/members', auth.requireOrgMember, (req, res) => {
  res.json({ members: db.listMembers(req.params.orgId) });
});

app.get('/v1/orgs/:orgId/databases', auth.requireOrgMember, auth.requireCapability('databases:list'), (req, res) => {
  res.json({ databases: db.listDatabases(req.params.orgId) });
});

app.get('/v1/orgs/:orgId/databases/:databaseId', auth.requireOrgMember, auth.requireCapability('databases:list'), (req, res) => {
  const database = db.findDatabaseInOrg(req.params.databaseId, req.params.orgId);
  if (!database) {
    return res.status(404).json({ error: 'Database not found.', code: 'NOT_FOUND' });
  }
  res.json({ database });
});

// Reading the actual rows requires records:read — which `reader` does NOT have.
app.get('/v1/orgs/:orgId/databases/:databaseId/records', auth.requireOrgMember, auth.requireCapability('records:read'), (req, res) => {
  const database = db.findDatabaseInOrg(req.params.databaseId, req.params.orgId);
  if (!database) {
    return res.status(404).json({ error: 'Database not found.', code: 'NOT_FOUND' });
  }
  res.json({ records: db.listRecords(database.id) });
});

app.post('/v1/orgs/:orgId/databases/:databaseId/records', auth.requireOrgMember, auth.requireCapability('records:write'), (req, res) => {
  const database = db.findDatabaseInOrg(req.params.databaseId, req.params.orgId);
  if (!database) {
    return res.status(404).json({ error: 'Database not found.', code: 'NOT_FOUND' });
  }
  const fields = (req.body && req.body.fields) || {};
  if (typeof fields !== 'object' || Array.isArray(fields)) {
    return res.status(400).json({ error: 'fields must be an object.', code: 'BAD_REQUEST' });
  }
  const record = db.addRecord(database.id, fields);
  res.status(201).json({ record });
});

// List backups — available to `reader` (the discovery vector for the backupId).
app.get('/v1/orgs/:orgId/databases/:databaseId/backups', auth.requireOrgMember, auth.requireCapability('backups:list'), (req, res) => {
  const database = db.findDatabaseInOrg(req.params.databaseId, req.params.orgId);
  if (!database) {
    return res.status(404).json({ error: 'Database not found.', code: 'NOT_FOUND' });
  }
  res.json({ backups: db.listBackups(req.params.orgId, database.id) });
});

app.post('/v1/orgs/:orgId/databases/:databaseId/backups', auth.requireOrgMember, auth.requireCapability('backups:create'), (req, res) => {
  const database = db.findDatabaseInOrg(req.params.databaseId, req.params.orgId);
  if (!database) {
    return res.status(404).json({ error: 'Database not found.', code: 'NOT_FOUND' });
  }
  const name = String((req.body && req.body.name) || `${database.name}-backup`).trim();
  const backup = db.createBackup(req.params.orgId, database.id, name);
  res.status(201).json({ backup });
});

// Reading a backup's metadata is correctly tenant-scoped: a backup that lives
// in another org is simply "not found" here (404). This is the control that
// PROVES the platform knows how to do object-level authorization — and makes
// the missing check on the restore path below unambiguous.
app.get('/v1/orgs/:orgId/backups/:backupId', auth.requireOrgMember, auth.requireCapability('backups:list'), (req, res) => {
  const backup = db.findBackupInOrg(req.params.backupId, req.params.orgId);
  if (!backup) {
    return res.status(404).json({ error: `Backup ${req.params.backupId} not found.`, code: 'NOT_FOUND' });
  }
  res.json({ backup });
});

// --------------------------------------------------------------------------
// THE VULNERABLE ENDPOINT
// --------------------------------------------------------------------------
// Create a database, optionally restoring it from an existing backup.
//
//   projectId      — sibling object reference. Ownership IS enforced
//                    (findProjectInOrg → 403 when it belongs to another org).
//
//   sourceBackupId — the restore source. Existence IS validated (400 when the id
//                    does not resolve), but ownership IS NOT. findBackupById()
//                    resolves the backup across ALL tenants, so an attacker who
//                    is admin of their OWN org can restore another org's backup
//                    and read every row it contains. This is the BOLA / CWE-639.
// --------------------------------------------------------------------------
app.post('/v1/orgs/:orgId/databases', auth.requireOrgMember, auth.requireCapability('databases:create'), (req, res) => {
  const orgId = req.params.orgId;
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'Database name is required.', code: 'BAD_REQUEST' });
  }

  // Sibling reference — ownership correctly enforced.
  let projectId = null;
  if (body.projectId) {
    const project = db.findProjectInOrg(body.projectId, orgId);
    if (!project) {
      return res.status(403).json({
        error: 'Project is not in the specified organization.',
        code: 'FORBIDDEN'
      });
    }
    projectId = project.id;
  }

  // Restore source — existence validated, ownership NOT validated (the bug).
  let restoreRecords = [];
  let restoredFromBackupId = null;
  if (body.sourceBackupId) {
    const backup = db.findBackupById(body.sourceBackupId); // <-- missing orgId scope
    if (!backup) {
      return res.status(400).json({
        error: `Invalid backup id ${body.sourceBackupId}.`,
        code: 'BAD_REQUEST'
      });
    }
    restoreRecords = backup.snapshot || [];
    restoredFromBackupId = backup.id;
  }

  const database = db.createDatabase(orgId, { name, projectId, restoreRecords, restoredFromBackupId });
  res.status(201).json({ database });
});

// --------------------------------------------------------------------------
// Self-service API keys (any member, scoped to their own role ceiling)
// --------------------------------------------------------------------------

app.get('/v1/orgs/:orgId/keys', auth.requireOrgMember, auth.requireCapability('keys:list'), (req, res) => {
  // Tokens are masked here; the secret is only ever returned at creation time.
  res.json({ keys: db.listApiKeys(req.params.orgId) });
});

app.post('/v1/orgs/:orgId/keys', auth.requireOrgMember, auth.requireCapability('keys:create'), (req, res) => {
  const body = req.body || {};
  const role = String(body.role || req.auth.role).toLowerCase();
  const allowed = auth.allowedRolesFor(req.auth.role);
  if (!allowed.includes(role)) {
    return res.status(403).json({
      error: `Your role (${req.auth.role}) cannot mint a "${role}" key.`,
      code: 'FORBIDDEN'
    });
  }
  const key = db.createApiKey(req.params.orgId, req.auth.userId, role, body.name);
  res.status(201).json({ key });
});

app.delete('/v1/orgs/:orgId/keys/:keyId', auth.requireOrgMember, auth.requireCapability('keys:revoke'), (req, res) => {
  if (req.params.keyId === req.auth.keyId) {
    return res.status(400).json({ error: 'You cannot revoke the key you are currently using.', code: 'BAD_REQUEST' });
  }
  const removed = db.revokeApiKey(req.params.orgId, req.params.keyId);
  if (!removed) {
    return res.status(404).json({ error: 'API key not found.', code: 'NOT_FOUND' });
  }
  res.json({ revoked: removed });
});

app.post('/v1/orgs/:orgId/invites', auth.requireOrgMember, auth.requireCapability('invites:create'), (req, res) => {
  const role = String((req.body && req.body.role) || 'reader').toLowerCase();
  if (!['admin', 'reader'].includes(role)) {
    return res.status(400).json({ error: 'role must be "admin" or "reader".', code: 'BAD_REQUEST' });
  }
  // A member can only invite at or below their own role.
  if (!auth.allowedRolesFor(req.auth.role).includes(role)) {
    return res.status(403).json({
      error: `Your role (${req.auth.role}) cannot invite a "${role}" member.`,
      code: 'FORBIDDEN'
    });
  }
  const invite = db.createInvite(req.params.orgId, role, req.auth.userId);
  res.status(201).json({
    invite: {
      code: invite.code,
      role: invite.role,
      url: `${config.baseUrl}/join/${invite.code}`,
      expiresAt: invite.expiresAt
    }
  });
});

// --------------------------------------------------------------------------
// Static SPA (console + invite acceptance page)
// --------------------------------------------------------------------------

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((error, req, res, next) => {
  const statusCode = error.statusCode || 500;
  if (statusCode >= 500) {
    console.error(error);
  }
  res.status(statusCode).json({
    error: statusCode >= 500 ? 'Something went wrong.' : error.message,
    code: error.errorCode || (statusCode >= 500 ? 'INTERNAL' : 'ERROR')
  });
});

app.listen(config.port, () => {
  console.log(`Meridian running on ${config.baseUrl}`);
});
