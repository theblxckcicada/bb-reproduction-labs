require('dotenv').config();

const port = Number(process.env.PORT || 5060);
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

module.exports = {
  port,
  baseUrl: baseUrl.replace(/\/$/, ''),
  // Invites expire after this many hours. Documentation/UX only — the lab keeps it generous.
  inviteTtlHours: Number(process.env.INVITE_TTL_HOURS || 72),
  // Browser session lifetime (cookie auth for the console). Programmatic API keys never expire.
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 168),
  // Name of the httpOnly cookie that carries the console session token.
  sessionCookie: process.env.SESSION_COOKIE || 'meridian_sid'
};
