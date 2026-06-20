'use strict';

const db = require('./db');
const config = require('./config');

/**
 * Role capability matrix.
 *
 *   admin  — full control of their own organization.
 *   reader — read-only, control-plane metadata only. Can list databases and
 *            backups (so monitoring/observability tooling works), but CANNOT
 *            create databases and CANNOT read the records (the data) themselves.
 *
 * The read-only `reader` key is the realistic discovery vector: it is the kind
 * of key handed to monitoring vendors, BI tools, contractors and CI, and it can
 * read a backup's identifier — which is all the cross-tenant restore bug needs.
 *
 * Self-service is intentional and is NOT the vulnerability: any member may
 * manage API keys and invite teammates, but only ever AT OR BELOW their own
 * role (see allowedRolesFor) — a reader can never mint an admin key or invite an
 * admin, so this grants no privilege escalation. A reader still cannot read
 * records or create databases.
 */
const ROLE_CAPABILITIES = {
  admin: new Set([
    'databases:list',
    'databases:create',
    'records:read',
    'records:write',
    'backups:list',
    'backups:create',
    'backups:read',
    'projects:list',
    'keys:list',
    'keys:create',
    'keys:revoke',
    'invites:create'
  ]),
  reader: new Set([
    'databases:list',
    'backups:list',
    'projects:list',
    'keys:list',
    'keys:create',
    'invites:create'
  ])
};

/**
 * Roles a member may grant when minting a key or sending an invite. A member
 * can only ever provision at or below their own role — this prevents a reader
 * from escalating to admin via self-service key/invite creation.
 */
function allowedRolesFor(callerRole) {
  return callerRole === 'admin' ? ['admin', 'reader'] : ['reader'];
}

function extractToken(req) {
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match) return match[1].trim();
  return null;
}

/** Parse the Cookie header into a plain `{ name: value }` map (no dependency). */
function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

/** Resolve the console session (cookie auth) attached to a request, or null. */
function resolveSession(req) {
  const token = parseCookies(req)[config.sessionCookie];
  if (!token) return null;
  const session = db.findSessionByToken(token);
  if (!session) return null;
  return { token, session };
}

/**
 * Authenticate every /v1 request. Two credential types are accepted, in order:
 *
 *   1. A programmatic API key (`Authorization: Bearer mk_…`) — the surface used
 *      by the terminal/curl, and the one the lab's exploit is run against.
 *   2. A console session cookie — the first-party web app calls the SAME API.
 *      The acting organization is the session's *selected* org and the role is
 *      that user's membership role in it.
 *
 * Either way the request ends up as `req.auth = { userId, orgId, role }`, so the
 * downstream handlers — including the vulnerable restore path — behave identically
 * whichever credential was used. Anonymous calls get 401.
 */
function authenticate(req, res, next) {
  const token = extractToken(req);
  if (token) {
    const apiKey = db.findApiKeyByToken(token);
    if (!apiKey) {
      return res.status(401).json({ error: 'Missing or invalid API key.', code: 'UNAUTHENTICATED' });
    }
    req.auth = {
      type: 'apiKey',
      keyId: apiKey.id,
      token: apiKey.token,
      userId: apiKey.userId,
      orgId: apiKey.orgId,
      role: apiKey.role
    };
    return next();
  }

  const resolved = resolveSession(req);
  if (resolved && resolved.session.activeOrgId) {
    const membership = db.findMembership(resolved.session.userId, resolved.session.activeOrgId);
    if (membership) {
      req.auth = {
        type: 'session',
        userId: resolved.session.userId,
        orgId: resolved.session.activeOrgId,
        role: membership.role
      };
      return next();
    }
  }

  return res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHENTICATED' });
}

/**
 * Guard for the console (`/app`) plane: require a valid session cookie and load
 * the user. Unlike authenticate(), this does NOT require an org to be selected —
 * it backs the identity/org-selection endpoints themselves.
 */
function requireSession(req, res, next) {
  const resolved = resolveSession(req);
  const user = resolved && db.findUser(resolved.session.userId);
  if (!resolved || !user) {
    return res.status(401).json({ error: 'Please sign in.', code: 'UNAUTHENTICATED' });
  }
  req.session = resolved.session;
  req.sessionToken = resolved.token;
  req.user = user;
  return next();
}

/** Capabilities granted to a role (array form, for the console UI). */
function capabilitiesFor(role) {
  return Array.from(ROLE_CAPABILITIES[role] || []);
}

/** Set the httpOnly session cookie carrying the console token. */
function setSessionCookie(res, token) {
  const maxAge = config.sessionTtlHours * 3600;
  res.setHeader(
    'Set-Cookie',
    `${config.sessionCookie}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`
  );
}

/** Clear the session cookie (logout). */
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${config.sessionCookie}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

function can(role, capability) {
  return Boolean(ROLE_CAPABILITIES[role] && ROLE_CAPABILITIES[role].has(capability));
}

/**
 * Enforce that the caller is acting within their OWN organization.
 *
 * This is deliberately the only tenant boundary the platform checks on the
 * path: a key may only operate inside the org it belongs to. The lab's bug is
 * that an attacker who stays inside their own org can still *reference* another
 * org's backup by id on the database-create path.
 */
function requireOrgMember(req, res, next) {
  const { orgId } = req.params;
  if (!db.findOrg(orgId)) {
    return res.status(404).json({ error: 'Organization not found.', code: 'NOT_FOUND' });
  }
  if (req.auth.orgId !== orgId) {
    return res.status(403).json({
      error: 'Your API key does not have access to this organization.',
      code: 'FORBIDDEN'
    });
  }
  return next();
}

/** Enforce a role capability for the resolved key. */
function requireCapability(capability) {
  return (req, res, next) => {
    if (!can(req.auth.role, capability)) {
      return res.status(403).json({
        error: `Your role (${req.auth.role}) is not permitted to perform this action.`,
        code: 'FORBIDDEN'
      });
    }
    return next();
  };
}

module.exports = {
  ROLE_CAPABILITIES,
  allowedRolesFor,
  authenticate,
  requireSession,
  resolveSession,
  capabilitiesFor,
  setSessionCookie,
  clearSessionCookie,
  requireOrgMember,
  requireCapability,
  can
};
