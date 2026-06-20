'use strict';

/**
 * Password hashing and session-token helpers.
 *
 * Uses only Node's built-in `crypto` (scrypt) so the lab needs no extra
 * dependency. Passwords are never stored in plaintext; session tokens are
 * stored only as a SHA-256 digest, so a leak of `data/db.json` does not reveal
 * a usable cookie. This is the AUTHENTICATION layer — it is deliberately sound,
 * so the lab's lesson stays focused on the AUTHORIZATION bug (cross-tenant BOLA)
 * rather than on weak credentials.
 */

const crypto = require('crypto');

const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;
const SESSION_TOKEN_BYTES = 32;

/**
 * Hash a plaintext password into a self-describing `salt:hash` string (both hex).
 *
 * @param {string} password - the plaintext password to hash.
 * @returns {string} the stored representation, safe to persist.
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const derived = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

/**
 * Verify a plaintext password against a stored `salt:hash` string.
 *
 * @param {string} password - the candidate plaintext password.
 * @param {string} stored - the value previously produced by hashPassword().
 * @returns {boolean} true when the password matches.
 */
function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) {
    return false;
  }
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) {
    return false;
  }
  const expected = Buffer.from(hashHex, 'hex');
  const derived = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN);
  // Constant-time comparison; lengths must match first to use timingSafeEqual.
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

/**
 * Generate a fresh, high-entropy session token (returned to the browser once).
 *
 * @returns {string} a URL-safe hex token.
 */
function newSessionToken() {
  return crypto.randomBytes(SESSION_TOKEN_BYTES).toString('hex');
}

/**
 * Hash a session token for at-rest storage. The plaintext token only ever lives
 * in the user's cookie.
 *
 * @param {string} token - the plaintext session token.
 * @returns {string} the SHA-256 hex digest of the token.
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

module.exports = {
  hashPassword,
  verifyPassword,
  newSessionToken,
  hashToken
};
