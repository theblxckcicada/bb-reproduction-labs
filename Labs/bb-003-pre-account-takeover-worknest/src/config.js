require('dotenv').config();

const port = Number(process.env.PORT || 5050);
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

module.exports = {
  port,
  baseUrl: baseUrl.replace(/\/$/, ''),
  sessionSecret: process.env.SESSION_SECRET || 'local-development-session-secret-change-me',
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    callbackPath: '/auth/google/callback'
  }
};
