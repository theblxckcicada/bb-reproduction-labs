"use strict";

const crypto = require("node:crypto");

/**
 * Encode a value using the unpadded base64url representation used by JWT.
 * @param {string | Buffer} value Value to encode.
 * @returns {string}
 */
function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

/**
 * Derive a salted password hash for the in-memory account store.
 * @param {string} password Plaintext password received at registration.
 * @returns {string}
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

/**
 * Compare a supplied password with a serialized scrypt password hash.
 * @param {string} password Supplied plaintext password.
 * @param {string} serializedHash Stored password hash.
 * @returns {boolean}
 */
function verifyPassword(password, serializedHash) {
  const parts = typeof serializedHash === "string" ? serializedHash.split("$") : [];
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }
  try {
    const salt = Buffer.from(parts[1], "base64url");
    const expected = Buffer.from(parts[2], "base64url");
    const supplied = crypto.scryptSync(password, salt, expected.length);
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  } catch {
    return false;
  }
}

/**
 * Create the lab's HMAC-backed access and refresh token service.
 * @param {Buffer | string} [secret] Optional test-only signing secret.
 * @returns {{ issue: Function, verify: Function, bundleFor: Function }}
 */
function createTokenService(secret = crypto.randomBytes(32)) {
  const key = Buffer.isBuffer(secret) ? secret : Buffer.from(secret);

  /**
   * Sign a user token.
   * @param {object} user Seeded user record.
   * @param {"access" | "refresh"} type Token type.
   * @param {number} ttlSeconds Lifetime in seconds.
   * @returns {string}
   */
  function issue(user, type, ttlSeconds) {
    const now = Math.floor(Date.now() / 1000);
    const header = encodeBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = encodeBase64Url(
      JSON.stringify({
        sub: user.id,
        email: user.email,
        role: user.role,
        type,
        aud: type === "access" ? "pulsewire-api" : "pulsewire-session",
        workspace: user.workspaceId,
        workspaceUser: user.id,
        iat: now,
        exp: now + ttlSeconds,
        jti: crypto.randomUUID(),
      })
    );
    const unsigned = `${header}.${payload}`;
    const signature = crypto.createHmac("sha256", key).update(unsigned).digest("base64url");
    return `${unsigned}.${signature}`;
  }

  /**
   * Validate and decode a signed token.
   * @param {string} token Serialized token.
   * @param {"access" | "refresh"} expectedType Expected token type.
   * @returns {object}
   */
  function verify(token, expectedType) {
    if (typeof token !== "string") {
      throw new Error("Token is missing.");
    }
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new Error("Token is malformed.");
    }

    const unsigned = `${parts[0]}.${parts[1]}`;
    const expected = crypto.createHmac("sha256", key).update(unsigned).digest();
    const supplied = Buffer.from(parts[2], "base64url");
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      throw new Error("Token signature is invalid.");
    }

    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (claims.type !== expectedType) {
      throw new Error(`Expected a ${expectedType} token.`);
    }
    if (!Number.isInteger(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) {
      throw new Error("Token has expired.");
    }
    return claims;
  }

  /**
   * Issue the token bundle written into the SaaS client's local storage.
   * @param {object} user Seeded user record.
   * @returns {{ accessToken: string, refreshToken: string, expiresIn: number }}
   */
  function bundleFor(user) {
    const expiresIn = 15 * 60;
    return {
      accessToken: issue(user, "access", expiresIn),
      refreshToken: issue(user, "refresh", 14 * 24 * 60 * 60),
      expiresIn,
    };
  }

  return { issue, verify, bundleFor };
}

module.exports = { createTokenService, hashPassword, verifyPassword };
