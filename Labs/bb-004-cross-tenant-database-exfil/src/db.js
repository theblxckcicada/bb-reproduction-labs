'use strict';

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const security = require('./security');

const dbPath = path.join(__dirname, '..', 'data', 'db.json');

/** A brand-new, empty platform — no tenants, no data. Users bootstrap everything. */
function emptyDb() {
  return {
    organizations: [],
    users: [],
    memberships: [],
    apiKeys: [],
    projects: [],
    databases: [],
    records: [],
    backups: [],
    invites: [],
    sessions: []
  };
}

function ensureDb() {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify(emptyDb(), null, 2));
  }
}

function readDb() {
  ensureDb();
  const raw = fs.readFileSync(dbPath, 'utf8');
  if (!raw.trim()) return emptyDb();
  // Merge onto a fresh shape so DB files written before a collection existed
  // (e.g. `sessions`) still load without crashing on a missing array.
  return { ...emptyDb(), ...JSON.parse(raw) };
}

function writeDb(db) {
  ensureDb();
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
  return db;
}

function resetDb() {
  return writeDb(emptyDb());
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'org';
}

function now() {
  return new Date().toISOString();
}

function httpError(statusCode, message, errorCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (errorCode) err.errorCode = errorCode;
  return err;
}

// --- Lookups --------------------------------------------------------------

function findApiKeyByToken(token) {
  if (!token) return null;
  const db = readDb();
  return db.apiKeys.find((key) => key.token === token) || null;
}

function findOrg(orgId) {
  const db = readDb();
  return db.organizations.find((org) => org.id === orgId) || null;
}

function findUser(userId) {
  const db = readDb();
  return db.users.find((user) => user.id === userId) || null;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/** Look a user up by their (case-insensitive) login email. */
function findUserByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const db = readDb();
  return db.users.find((user) => user.email === normalized) || null;
}

/** The caller's role inside a specific org, or null when they are not a member. */
function findMembership(userId, orgId) {
  const db = readDb();
  return db.memberships.find((m) => m.userId === userId && m.orgId === orgId) || null;
}

/** Every org a user belongs to, decorated with org metadata and their role. */
function listMembershipsByUser(userId) {
  const db = readDb();
  return db.memberships
    .filter((m) => m.userId === userId)
    .map((m) => {
      const org = db.organizations.find((o) => o.id === m.orgId);
      return org
        ? { orgId: org.id, name: org.name, slug: org.slug, role: m.role, createdAt: org.createdAt }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** People (and their role) in an organization — powers the Members view. */
function listMembers(orgId) {
  const db = readDb();
  return db.memberships
    .filter((m) => m.orgId === orgId)
    .map((m) => {
      const user = db.users.find((u) => u.id === m.userId);
      return {
        userId: m.userId,
        name: user ? user.name : 'Unknown',
        email: user ? user.email : null,
        role: m.role
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function listProjects(orgId) {
  const db = readDb();
  return db.projects.filter((project) => project.orgId === orgId);
}

/** Ownership-scoped project lookup (the SAFE sibling reference). */
function findProjectInOrg(projectId, orgId) {
  const db = readDb();
  return db.projects.find((project) => project.id === projectId && project.orgId === orgId) || null;
}

function listDatabases(orgId) {
  const db = readDb();
  return db.databases
    .filter((database) => database.orgId === orgId)
    .map((database) => decorateDatabase(db, database))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function findDatabaseInOrg(databaseId, orgId) {
  const db = readDb();
  const database = db.databases.find((item) => item.id === databaseId && item.orgId === orgId);
  return database ? decorateDatabase(db, database) : null;
}

function decorateDatabase(db, database) {
  const recordCount = db.records.filter((record) => record.databaseId === database.id).length;
  return { ...database, recordCount };
}

function listRecords(databaseId) {
  const db = readDb();
  return db.records.filter((record) => record.databaseId === databaseId);
}

function listBackups(orgId, databaseId) {
  const db = readDb();
  return db.backups
    .filter((item) => item.orgId === orgId && item.databaseId === databaseId)
    .map(publicBackup)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** Ownership-scoped backup lookup (the SAFE read path → cross-tenant 404). */
function findBackupInOrg(backupId, orgId) {
  const db = readDb();
  const found = db.backups.find((item) => item.id === backupId && item.orgId === orgId);
  return found ? publicBackup(found) : null;
}

/**
 * Existence-only backup lookup used by the database-restore path.
 *
 * NOTE: this intentionally does NOT scope by orgId — it is the missing
 * object-level authorization check that the lab demonstrates. Compare with
 * findBackupInOrg(), which correctly scopes reads to the caller's org.
 */
function findBackupById(backupId) {
  const db = readDb();
  return db.backups.find((item) => item.id === backupId) || null;
}

function publicBackup(item) {
  return {
    id: item.id,
    orgId: item.orgId,
    databaseId: item.databaseId,
    name: item.name,
    recordCount: item.recordCount,
    sizeBytes: item.sizeBytes,
    createdAt: item.createdAt
  };
}

// --- Mutations ------------------------------------------------------------

function createDatabase(orgId, { name, projectId, restoreRecords, restoredFromBackupId }) {
  const db = readDb();
  const database = {
    id: uuidv4(),
    orgId,
    projectId: projectId || null,
    name,
    state: 'ready',
    restoredFromBackupId: restoredFromBackupId || null,
    createdAt: now()
  };
  db.databases.push(database);

  for (const restored of restoreRecords || []) {
    db.records.push({
      id: uuidv4(),
      databaseId: database.id,
      fields: { ...restored.fields }
    });
  }

  writeDb(db);
  return decorateDatabase(db, database);
}

function addRecord(databaseId, fields) {
  const db = readDb();
  const record = { id: uuidv4(), databaseId, fields: { ...fields } };
  db.records.push(record);
  writeDb(db);
  return record;
}

function createBackup(orgId, databaseId, name) {
  const db = readDb();
  const snapshot = db.records
    .filter((record) => record.databaseId === databaseId)
    .map((record) => ({ fields: { ...record.fields } }));

  const backupRow = {
    id: uuidv4(),
    orgId,
    databaseId,
    name,
    recordCount: snapshot.length,
    sizeBytes: Math.max(1024, snapshot.length * 1024),
    createdAt: now(),
    snapshot
  };
  db.backups.push(backupRow);
  writeDb(db);
  return publicBackup(backupRow);
}

/** Provision an org + default project owned by `user` with the given role, mutating `db` in place. */
function provisionOrg(db, user, orgName, role) {
  let slug = slugify(orgName);
  let suffix = 1;
  while (db.organizations.some((org) => org.slug === slug)) {
    suffix += 1;
    slug = `${slugify(orgName)}-${suffix}`;
  }

  const org = {
    id: uuidv4(),
    slug,
    name: String(orgName || '').trim() || 'My Organization',
    createdAt: now()
  };
  db.organizations.push(org);
  db.memberships.push({ id: uuidv4(), userId: user.id, orgId: org.id, role });
  db.projects.push({ id: uuidv4(), orgId: org.id, name: 'Default', createdAt: now() });
  return org;
}

/**
 * Sign-up bootstrap (console plane): create a password-backed user account and a
 * brand-new organization they own (admin). This is how every tenant in the lab
 * comes into existence — there is no seed data. No API key is minted here; keys
 * are self-service and created later from the console for terminal/API use.
 *
 * @throws {Error} 409 when the email is already registered.
 */
function createUserAccount({ name, email, password, orgName }) {
  const db = readDb();
  const normalizedEmail = normalizeEmail(email);
  if (db.users.some((user) => user.email === normalizedEmail)) {
    throw httpError(409, 'An account with that email already exists.', 'EMAIL_TAKEN');
  }

  const user = {
    id: uuidv4(),
    name: String(name || '').trim() || 'Owner',
    email: normalizedEmail,
    passwordHash: security.hashPassword(password),
    createdAt: now()
  };
  db.users.push(user);

  const org = provisionOrg(db, user, orgName, 'admin');
  writeDb(db);
  return { user, org };
}

/**
 * Create an additional organization owned (admin) by an existing user. This is
 * what lets a single account belong to several organizations and switch between
 * them in the console.
 */
function createOrgForUser(userId, orgName) {
  const db = readDb();
  const user = db.users.find((u) => u.id === userId);
  if (!user) {
    throw httpError(404, 'User not found.', 'NOT_FOUND');
  }
  const org = provisionOrg(db, user, orgName, 'admin');
  writeDb(db);
  return org;
}

function maskToken(token) {
  if (!token || token.length <= 12) return token;
  return `${token.slice(0, 8)}…${token.slice(-4)}`;
}

function publicKey(key, { reveal = false } = {}) {
  const view = {
    id: key.id,
    name: key.name,
    role: key.role,
    userId: key.userId,
    tokenMasked: maskToken(key.token),
    createdAt: key.createdAt
  };
  if (reveal) view.token = key.token;
  return view;
}

function listApiKeys(orgId) {
  const db = readDb();
  return db.apiKeys
    .filter((key) => key.orgId === orgId)
    .map((key) => publicKey(key))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function createApiKey(orgId, userId, role, name) {
  const db = readDb();
  const key = {
    id: uuidv4(),
    token: `mk_${role}_${uuidv4().replace(/-/g, '').slice(0, 16)}`,
    userId,
    orgId,
    role,
    name: String(name || '').trim() || `${role} key`,
    createdAt: now()
  };
  db.apiKeys.push(key);
  writeDb(db);
  // Returned with the secret exactly once, at creation time.
  return publicKey(key, { reveal: true });
}

function revokeApiKey(orgId, keyId) {
  const db = readDb();
  const index = db.apiKeys.findIndex((key) => key.id === keyId && key.orgId === orgId);
  if (index < 0) return null;
  const [removed] = db.apiKeys.splice(index, 1);
  writeDb(db);
  return publicKey(removed);
}

function createInvite(orgId, role, createdByUserId) {
  const db = readDb();
  const code = `inv_${uuidv4().replace(/-/g, '').slice(0, 20)}`;
  const invite = {
    code,
    orgId,
    role,
    createdBy: createdByUserId,
    createdAt: now(),
    expiresAt: new Date(Date.now() + config.inviteTtlHours * 3_600_000).toISOString(),
    acceptedByUserId: null
  };
  db.invites.push(invite);
  writeDb(db);
  return invite;
}

function findInvite(code) {
  const db = readDb();
  return db.invites.find((invite) => invite.code === code) || null;
}

/**
 * Accept an invite as an already-authenticated user: grant them a membership in
 * the inviting org at the invite's role. Because the same account can hold many
 * memberships, this is the realistic "join another organization" flow that backs
 * the console's org switcher. No API key is minted — keys are self-service.
 *
 * @throws {Error} 404/409/410 for missing, used, or expired invites.
 */
function acceptInviteForUser(code, userId) {
  const db = readDb();
  const invite = db.invites.find((item) => item.code === code);
  if (!invite) {
    throw httpError(404, 'Invite not found.', 'NOT_FOUND');
  }
  if (invite.acceptedByUserId) {
    throw httpError(409, 'This invite has already been used.', 'ALREADY_USED');
  }
  if (new Date(invite.expiresAt).getTime() < Date.now()) {
    throw httpError(410, 'This invite has expired.', 'EXPIRED');
  }

  const existing = db.memberships.find((m) => m.userId === userId && m.orgId === invite.orgId);
  if (existing) {
    throw httpError(409, 'You are already a member of this organization.', 'ALREADY_MEMBER');
  }

  db.memberships.push({ id: uuidv4(), userId, orgId: invite.orgId, role: invite.role });
  invite.acceptedByUserId = userId;
  writeDb(db);

  return {
    org: db.organizations.find((org) => org.id === invite.orgId) || null,
    role: invite.role
  };
}

// --- Sessions (console cookie auth) --------------------------------------

/**
 * Create a browser session for a user and return the plaintext token (shown to
 * the browser once, via an httpOnly cookie). Only a hash of the token is stored.
 */
function createSession(userId, activeOrgId) {
  const db = readDb();
  const token = security.newSessionToken();
  const session = {
    id: uuidv4(),
    tokenHash: security.hashToken(token),
    userId,
    activeOrgId: activeOrgId || null,
    createdAt: now(),
    expiresAt: new Date(Date.now() + config.sessionTtlHours * 3_600_000).toISOString()
  };
  db.sessions.push(session);
  writeDb(db);
  return { token, session };
}

/** Resolve a (non-expired) session from its plaintext token, or null. */
function findSessionByToken(token) {
  if (!token) return null;
  const hash = security.hashToken(token);
  const db = readDb();
  const session = db.sessions.find((s) => s.tokenHash === hash) || null;
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) return null;
  return session;
}

/** Switch the active organization for a session (caller must verify membership). */
function setSessionActiveOrg(token, orgId) {
  const hash = security.hashToken(token);
  const db = readDb();
  const session = db.sessions.find((s) => s.tokenHash === hash);
  if (!session) return null;
  session.activeOrgId = orgId;
  writeDb(db);
  return session;
}

/** Invalidate a session (logout). */
function deleteSession(token) {
  const hash = security.hashToken(token);
  const db = readDb();
  const index = db.sessions.findIndex((s) => s.tokenHash === hash);
  if (index < 0) return false;
  db.sessions.splice(index, 1);
  writeDb(db);
  return true;
}

module.exports = {
  dbPath,
  resetDb,
  httpError,
  createUserAccount,
  createOrgForUser,
  findApiKeyByToken,
  findOrg,
  findUser,
  findUserByEmail,
  findMembership,
  listMembershipsByUser,
  listMembers,
  listProjects,
  findProjectInOrg,
  listDatabases,
  findDatabaseInOrg,
  listRecords,
  listBackups,
  findBackupInOrg,
  findBackupById,
  createDatabase,
  addRecord,
  createBackup,
  listApiKeys,
  createApiKey,
  revokeApiKey,
  createInvite,
  findInvite,
  acceptInviteForUser,
  createSession,
  findSessionByToken,
  setSessionActiveOrg,
  deleteSession
};
