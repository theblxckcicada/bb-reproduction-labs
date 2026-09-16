'use strict';

const port = Number.parseInt(process.env.PORT || '5070', 10);
const host = process.env.HOST || '127.0.0.1';

module.exports = {
  port,
  host,
  baseUrl: String(process.env.BASE_URL || `http://${host}:${port}`).replace(/\/$/, ''),
  sessionSecret: process.env.SESSION_SECRET || 'roster-relay-local-lab-only'
};
