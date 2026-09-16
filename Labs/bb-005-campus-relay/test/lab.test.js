'use strict';

process.env.PORT = '0';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
db.resetDatabase();
const { server } = require('../src/server');

let origin;
test.before(async () => {
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { db.resetDatabase(); server.close(); });

async function request(path, { cookie, method = 'GET', body, redirect } = {}) {
  const response = await fetch(`${origin}${path}`, { method, redirect, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { response, body: json, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

async function register(name, email) {
  const result = await request('/api/auth/register', { method: 'POST', body: { name, email, password: 'test-password-2026' } });
  assert.equal(result.response.status, 201);
  return result.cookie;
}

test('two user-created teacher accounts can reproduce the full cross-class login chain', async () => {
  const victimCookie = await register('Victim Teacher', 'victim@school.test');
  const victimClass = await request('/api/classes', { cookie: victimCookie, method: 'POST', body: { name: 'Science 7B' } });
  const victimStudent = await request('/api/students', { cookie: victimCookie, method: 'POST', body: { firstName: 'Alex', lastName: 'Morgan' } });
  await request(`/api/students/${victimStudent.body.student.id}/enroll`, { cookie: victimCookie, method: 'POST', body: { classIds: [victimClass.body.class.id] } });

  const attackerCookie = await register('Second Teacher', 'second@school.test');
  const attackerClass = await request('/api/classes', { cookie: attackerCookie, method: 'POST', body: { name: 'History 8A' } });
  const graft = await request(`/api/students/${victimStudent.body.student.id}/enroll`, { cookie: attackerCookie, method: 'POST', body: { classIds: [attackerClass.body.class.id] } });
  assert.equal(graft.response.status, 204);

  const links = await request(`/api/classLoginLinks/${attackerClass.body.class.id}`, { cookie: attackerCookie });
  const victimLink = links.body.find((item) => item.id === victimStudent.body.student.id);
  assert.ok(victimLink);
  const token = new URL(victimLink.accessInstructionsLink).pathname.split('/').pop();
  const exchange = await request(`/api/studentPortalLogin/${token}`);
  assert.equal(exchange.response.status, 200);

  const oneTapPath = new URL(exchange.body.url).pathname + new URL(exchange.body.url).search;
  const transition = await request(oneTapPath, { redirect: 'manual' });
  assert.equal(transition.response.status, 302);
  const session = await request('/api/session', { cookie: transition.cookie });
  assert.equal(session.body.type, 'student');
  assert.equal(session.body.student.id, victimStudent.body.student.id);
});

test('destination class authorization remains enforced', async () => {
  const ownerCookie = await register('Class Owner', 'owner@school.test');
  const ownerClass = await request('/api/classes', { cookie: ownerCookie, method: 'POST', body: { name: 'English 9C' } });
  const ownerStudent = await request('/api/students', { cookie: ownerCookie, method: 'POST', body: { firstName: 'Taylor', lastName: 'Lee' } });
  const outsiderCookie = await register('Outside Teacher', 'outside@school.test');
  const result = await request(`/api/students/${ownerStudent.body.student.id}/enroll`, { cookie: outsiderCookie, method: 'POST', body: { classIds: [ownerClass.body.class.id] } });
  assert.equal(result.response.status, 403);
});
