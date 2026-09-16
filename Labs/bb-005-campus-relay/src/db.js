'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dbPath = path.join(__dirname, '..', 'data', 'db.json');
const emptyDatabase = { users: [], groups: [], participants: [], accessLinks: [], loginTickets: [] };

function cloneEmptyDatabase() {
  return JSON.parse(JSON.stringify(emptyDatabase));
}

function ensureDatabase() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify(emptyDatabase, null, 2));
}

function readDatabase() {
  ensureDatabase();
  const content = fs.readFileSync(dbPath, 'utf8').trim();
  return content ? JSON.parse(content) : cloneEmptyDatabase();
}

function writeDatabase(database) {
  ensureDatabase();
  fs.writeFileSync(dbPath, JSON.stringify(database, null, 2));
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(9).toString('hex')}`;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function publicUser(user) {
  return user ? { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt } : null;
}

function findUserByEmail(email) {
  return readDatabase().users.find((user) => user.email === normalizeEmail(email)) || null;
}

function findUserById(userId) {
  return readDatabase().users.find((user) => user.id === userId) || null;
}

function createUser({ name, email, passwordHash }) {
  const database = readDatabase();
  const normalizedEmail = normalizeEmail(email);
  if (database.users.some((user) => user.email === normalizedEmail)) {
    const error = new Error('An account with that email already exists.');
    error.statusCode = 409;
    throw error;
  }
  const user = { id: id('usr'), name: String(name).trim(), email: normalizedEmail, passwordHash, createdAt: new Date().toISOString() };
  database.users.push(user);
  writeDatabase(database);
  return user;
}

function listGroups(userId) {
  const database = readDatabase();
  return database.groups.filter((group) => group.ownerId === userId).map((group) => ({ ...group, participantCount: group.participantIds.length }));
}

function findGroupInOwnerScope(groupId, userId) {
  return readDatabase().groups.find((group) => group.id === groupId && group.ownerId === userId) || null;
}

function createGroup(userId, name) {
  const database = readDatabase();
  const group = { id: id('cls'), ownerId: userId, name: String(name).trim(), participantIds: [], createdAt: new Date().toISOString() };
  database.groups.push(group);
  writeDatabase(database);
  return group;
}

function listParticipants(userId) {
  return readDatabase().participants.filter((participant) => participant.ownerId === userId);
}

function createParticipant(userId, { firstName, lastName }) {
  const database = readDatabase();
  const participant = { id: id('stu'), ownerId: userId, firstName: String(firstName).trim(), lastName: String(lastName).trim(), createdAt: new Date().toISOString() };
  database.participants.push(participant);
  writeDatabase(database);
  return participant;
}

function addParticipantToGroupsGlobally(participantId, groupIds, actingUserId) {
  const database = readDatabase();
  const participant = database.participants.find((item) => item.id === participantId);
  if (!participant) return { error: 'PARTICIPANT_NOT_FOUND' };
  const groups = groupIds.map((groupId) => database.groups.find((group) => group.id === groupId && group.ownerId === actingUserId));
  if (groups.some((group) => !group)) return { error: 'GROUP_FORBIDDEN' };
  groups.forEach((group) => {
    if (!group.participantIds.includes(participant.id)) group.participantIds.push(participant.id);
  });
  writeDatabase(database);
  return { participant };
}

function listGroupParticipants(groupId, userId) {
  const database = readDatabase();
  const group = database.groups.find((item) => item.id === groupId && item.ownerId === userId);
  if (!group) return null;
  return group.participantIds.map((participantId) => database.participants.find((participant) => participant.id === participantId)).filter(Boolean);
}

function issueAccessLinks(groupId, userId) {
  const database = readDatabase();
  const group = database.groups.find((item) => item.id === groupId && item.ownerId === userId);
  if (!group) return null;
  const now = Date.now();
  const links = group.participantIds.map((participantId) => {
    const participant = database.participants.find((item) => item.id === participantId);
    let link = database.accessLinks.find((item) => item.groupId === groupId && item.participantId === participantId && new Date(item.expiresAt).getTime() > now);
    if (!link) {
      link = { token: crypto.randomBytes(28).toString('base64url'), groupId, participantId, issuedBy: userId, expiresAt: new Date(now + 30 * 60 * 1000).toISOString() };
      database.accessLinks.push(link);
    }
    return { participant, token: link.token, expiresAt: link.expiresAt };
  });
  writeDatabase(database);
  return links;
}

function exchangeAccessLink(token) {
  const database = readDatabase();
  const link = database.accessLinks.find((item) => item.token === token && new Date(item.expiresAt).getTime() > Date.now());
  if (!link) return null;
  const ticket = { token: crypto.randomBytes(32).toString('base64url'), participantId: link.participantId, expiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString() };
  database.loginTickets.push(ticket);
  writeDatabase(database);
  return ticket;
}

function consumeLoginTicket(participantId, token) {
  const database = readDatabase();
  const index = database.loginTickets.findIndex((ticket) => ticket.token === token && ticket.participantId === participantId && new Date(ticket.expiresAt).getTime() > Date.now());
  if (index < 0) return null;
  database.loginTickets.splice(index, 1);
  const participant = database.participants.find((item) => item.id === participantId) || null;
  writeDatabase(database);
  return participant;
}

function resetDatabase() {
  writeDatabase(cloneEmptyDatabase());
}

module.exports = { dbPath, normalizeEmail, publicUser, findUserByEmail, findUserById, createUser, listGroups, findGroupInOwnerScope, createGroup, listParticipants, createParticipant, addParticipantToGroupsGlobally, listGroupParticipants, issueAccessLinks, exchangeAccessLink, consumeLoginTicket, resetDatabase };
