'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const config = require('./config');
const db = require('./db');
const auth = require('./auth');

const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '64kb' }));
app.use(session({ name: 'relay.sid', secret: config.sessionSecret, resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 } }));

function asyncHandler(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

function requestBaseUrl(request) {
  return process.env.BASE_URL || `${request.protocol}://${request.get('host')}`;
}

app.get('/api/health', (request, response) => response.json({ ok: true, app: 'Campus Relay' }));

app.post('/api/auth/register', asyncHandler(async (request, response) => {
  const name = String(request.body?.name || '').trim();
  const email = db.normalizeEmail(request.body?.email);
  const password = String(request.body?.password || '');
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return response.status(400).json({ error: 'Name, valid email, and a password of at least 8 characters are required.', code: 'BAD_REQUEST' });
  const user = db.createUser({ name, email, passwordHash: await auth.hashPassword(password) });
  request.session.regenerate((error) => {
    if (error) return response.status(500).json({ error: 'Could not create session.', code: 'INTERNAL' });
    request.session.userId = user.id;
    request.session.identityType = 'coordinator';
    return response.status(201).json({ type: 'coordinator', user: db.publicUser(user) });
  });
}));

app.post('/api/auth/login', asyncHandler(async (request, response) => {
  const user = db.findUserByEmail(request.body?.email);
  if (!user || !(await auth.verifyPassword(String(request.body?.password || ''), user.passwordHash))) return response.status(401).json({ error: 'Invalid email or password.', code: 'UNAUTHENTICATED' });
  request.session.regenerate((error) => {
    if (error) return response.status(500).json({ error: 'Could not create session.', code: 'INTERNAL' });
    request.session.userId = user.id;
    request.session.identityType = 'coordinator';
    return response.json({ type: 'coordinator', user: db.publicUser(user) });
  });
}));

app.post('/api/auth/logout', (request, response) => request.session.destroy(() => response.json({ ok: true })));

app.get('/api/session', (request, response) => {
  if (request.session.identityType === 'coordinator') {
    const user = db.findUserById(request.session.userId);
    if (user) return response.json({ type: 'coordinator', user: db.publicUser(user) });
  }
  if (request.session.identityType === 'student') {
    return response.json({ type: 'student', student: request.session.student });
  }
  return response.status(401).json({ error: 'No active session.', code: 'UNAUTHENTICATED' });
});

app.get('/api/classes', auth.requireCoordinator, (request, response) => response.json({ classes: db.listGroups(request.user.id) }));
app.post('/api/classes', auth.requireCoordinator, (request, response) => {
  const name = String(request.body?.name || '').trim();
  if (!name) return response.status(400).json({ error: 'Group name is required.', code: 'BAD_REQUEST' });
  return response.status(201).json({ class: db.createGroup(request.user.id, name) });
});
app.get('/api/students', auth.requireCoordinator, (request, response) => response.json({ students: db.listParticipants(request.user.id) }));
app.post('/api/students', auth.requireCoordinator, (request, response) => {
  const firstName = String(request.body?.firstName || '').trim();
  const lastName = String(request.body?.lastName || '').trim();
  if (!firstName || !lastName) return response.status(400).json({ error: 'First and last name are required.', code: 'BAD_REQUEST' });
  return response.status(201).json({ student: db.createParticipant(request.user.id, { firstName, lastName }) });
});

// Vulnerable by design: destination ownership is checked, source ownership is not.
app.post('/api/students/:studentId/enroll', auth.requireCoordinator, (request, response) => {
  const classIds = request.body?.classIds;
  if (!Array.isArray(classIds) || classIds.length === 0 || classIds.some((item) => typeof item !== 'string')) return response.status(400).json({ error: 'classIds must be a non-empty string array.', code: 'BAD_REQUEST' });
  const result = db.addParticipantToGroupsGlobally(request.params.studentId, classIds, request.user.id);
  if (result.error === 'PARTICIPANT_NOT_FOUND') return response.status(404).json({ error: 'Participant not found.', code: 'NOT_FOUND' });
  if (result.error === 'GROUP_FORBIDDEN') return response.status(403).json({ error: 'You do not manage every destination group.', code: 'FORBIDDEN' });
  return response.status(204).end();
});

app.get('/api/classes/:classId/students', auth.requireCoordinator, (request, response) => {
  const students = db.listGroupParticipants(request.params.classId, request.user.id);
  if (!students) return response.status(404).json({ error: 'Class not found.', code: 'NOT_FOUND' });
  return response.json({ students });
});

app.get('/api/classLoginLinks/:classId', auth.requireCoordinator, (request, response) => {
  const links = db.issueAccessLinks(request.params.classId, request.user.id);
  if (!links) return response.status(404).json({ error: 'Class not found.', code: 'NOT_FOUND' });
  return response.json(links.map(({ participant, token, expiresAt }) => ({ id: participant.id, firstName: participant.firstName, lastName: participant.lastName, accessInstructionsLink: `${requestBaseUrl(request)}/access/${token}`, expiresAt })));
});

app.get('/api/studentPortalLogin/:token', (request, response) => {
  const ticket = db.exchangeAccessLink(request.params.token);
  if (!ticket) return response.status(404).json({ error: 'Access link not found or expired.', code: 'NOT_FOUND' });
  return response.json({ url: `${requestBaseUrl(request)}/one-tap?subject=${encodeURIComponent(ticket.participantId)}&ticket=${encodeURIComponent(ticket.token)}` });
});

app.get('/one-tap', (request, response) => {
  const participant = db.consumeLoginTicket(String(request.query.subject || ''), String(request.query.ticket || ''));
  if (!participant) return response.status(401).send('Invalid or expired login ticket.');
  request.session.regenerate((error) => {
    if (error) return response.status(500).send('Could not create participant session.');
    request.session.identityType = 'student';
    request.session.student = { id: participant.id, firstName: participant.firstName, lastName: participant.lastName };
    return response.redirect('/');
  });
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (request, response) => response.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
app.use((error, request, response, next) => {
  if ((error.statusCode || 500) >= 500) console.error(error);
  response.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Unexpected server error.', code: error.statusCode ? 'REQUEST_FAILED' : 'INTERNAL' });
});

const server = app.listen(config.port, config.host, () => console.log(`Campus Relay running at ${config.baseUrl}`));
module.exports = { app, server };
