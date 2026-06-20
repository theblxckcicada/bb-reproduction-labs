const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const dbPath = path.join(__dirname, '..', 'data', 'db.json');

const defaultDb = {
  users: [],
  projects: []
};

function ensureDb() {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify(defaultDb, null, 2));
  }
}

function readDb() {
  ensureDb();
  const raw = fs.readFileSync(dbPath, 'utf8');
  if (!raw.trim()) return structuredClone(defaultDb);
  return JSON.parse(raw);
}

function writeDb(db) {
  ensureDb();
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
  return db;
}

function now() {
  return new Date().toISOString();
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function findUserByEmail(email) {
  const db = readDb();
  return db.users.find((user) => user.email === normalizeEmail(email)) || null;
}

function findUserById(id) {
  const db = readDb();
  return db.users.find((user) => user.id === id) || null;
}

function createUser(input) {
  const db = readDb();
  const email = normalizeEmail(input.email);

  if (db.users.some((user) => user.email === email)) {
    const err = new Error('An account with that email already exists.');
    err.statusCode = 409;
    throw err;
  }

  const user = {
    id: uuidv4(),
    email,
    displayName: String(input.displayName || '').trim() || email.split('@')[0],
    passwordHash: input.passwordHash || null,
    providerLinks: input.providerLinks || {},
    avatarUrl: input.avatarUrl || null,
    emailVerified: Boolean(input.emailVerified),
    createdAt: now(),
    updatedAt: now()
  };

  db.users.push(user);
  writeDb(db);
  return user;
}

function updateUser(userId, updater) {
  const db = readDb();
  const index = db.users.findIndex((user) => user.id === userId);
  if (index < 0) return null;

  const updated = {
    ...db.users[index],
    ...updater(db.users[index]),
    updatedAt: now()
  };

  db.users[index] = updated;
  writeDb(db);
  return updated;
}

function createProject(userId, input) {
  const db = readDb();
  const title = String(input.title || '').trim();
  const client = String(input.client || '').trim();

  if (!title) {
    const err = new Error('Project title is required.');
    err.statusCode = 400;
    throw err;
  }

  const project = {
    id: uuidv4(),
    userId,
    title,
    client: client || 'Internal',
    dueDate: input.dueDate || null,
    notes: String(input.notes || '').trim(),
    createdAt: now(),
    tasks: []
  };

  db.projects.unshift(project);
  writeDb(db);
  return project;
}

function listProjects(userId) {
  const db = readDb();
  return db.projects
    .filter((project) => project.userId === userId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function addTask(userId, projectId, input) {
  const db = readDb();
  const project = db.projects.find((item) => item.id === projectId && item.userId === userId);

  if (!project) {
    const err = new Error('Project not found.');
    err.statusCode = 404;
    throw err;
  }

  const title = String(input.title || '').trim();
  if (!title) {
    const err = new Error('Task title is required.');
    err.statusCode = 400;
    throw err;
  }

  const task = {
    id: uuidv4(),
    title,
    status: input.status === 'done' ? 'done' : 'open',
    createdAt: now()
  };

  project.tasks.unshift(task);
  writeDb(db);
  return task;
}

function updateTask(userId, projectId, taskId, input) {
  const db = readDb();
  const project = db.projects.find((item) => item.id === projectId && item.userId === userId);

  if (!project) {
    const err = new Error('Project not found.');
    err.statusCode = 404;
    throw err;
  }

  const task = project.tasks.find((item) => item.id === taskId);
  if (!task) {
    const err = new Error('Task not found.');
    err.statusCode = 404;
    throw err;
  }

  if (Object.prototype.hasOwnProperty.call(input, 'status')) {
    task.status = input.status === 'done' ? 'done' : 'open';
  }

  if (Object.prototype.hasOwnProperty.call(input, 'title')) {
    const title = String(input.title || '').trim();
    if (title) task.title = title;
  }

  writeDb(db);
  return task;
}

function resetDb() {
  writeDb(structuredClone(defaultDb));
}

module.exports = {
  dbPath,
  normalizeEmail,
  findUserByEmail,
  findUserById,
  createUser,
  updateUser,
  createProject,
  listProjects,
  addTask,
  updateTask,
  resetDb
};
