'use strict';

const bcrypt = require('bcryptjs');
const db = require('./db');

async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function requireCoordinator(request, response, next) {
  if (request.session.identityType !== 'coordinator') return response.status(401).json({ error: 'Teacher authentication required.', code: 'UNAUTHENTICATED' });
  const user = db.findUserById(request.session.userId);
  if (!user) return response.status(401).json({ error: 'Session is no longer valid.', code: 'UNAUTHENTICATED' });
  request.user = user;
  return next();
}

module.exports = { hashPassword, verifyPassword, requireCoordinator };
