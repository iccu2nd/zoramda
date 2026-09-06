import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'node:path';
import fs from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import config from '../config/index.js';
import logger from '../utils/logger.js';

const defaultData = {
  users: [],
  bots: [],
  sessions: []
};

let db = null;
let writeQueue = Promise.resolve();

function withLock(fn) {
  const result = writeQueue.then(fn);
  writeQueue = result.then(() => {}, () => {});
  return result;
}

export async function initDb() {
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }
  const file = path.join(config.dataDir, 'zorabot.json');
  const adapter = new JSONFile(file);
  db = new Low(adapter, defaultData);
  await db.read();
  if (!db.data) {
    db.data = structuredClone(defaultData);
    await db.write();
  }
  // ensure arrays
  db.data.users ||= [];
  db.data.bots ||= [];
  db.data.sessions ||= [];
  await db.write();
  logger.info('Database initialized');
  return db;
}

function ensureDb() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

// ---- Users ----
export async function createUser({ username, password }) {
  const hash = await bcrypt.hash(password, 12);
  return withLock(async () => {
    const d = ensureDb();
    await d.read();
    if (d.data.users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
      throw new Error('Username already exists');
    }
    const user = {
      id: uuidv4(),
      username: username.trim(),
      passwordHash: hash,
      createdAt: new Date().toISOString()
    };
    d.data.users.push(user);
    await d.write();
    return { id: user.id, username: user.username, createdAt: user.createdAt };
  });
}

export async function findUserByUsername(username) {
  const d = ensureDb();
  await d.read();
  return d.data.users.find(u => u.username.toLowerCase() === username.toLowerCase()) || null;
}

export async function findUserById(id) {
  const d = ensureDb();
  await d.read();
  return d.data.users.find(u => u.id === id) || null;
}

export async function verifyPassword(user, password) {
  return bcrypt.compare(password, user.passwordHash);
}

// ---- Auth Sessions (web) ----
export async function createSession(userId) {
  return withLock(async () => {
    const d = ensureDb();
    await d.read();
    const sid = uuidv4();
    const session = {
      id: sid,
      userId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + config.cookie.maxAge).toISOString()
    };
    d.data.sessions.push(session);
    // cleanup expired
    d.data.sessions = d.data.sessions.filter(s => new Date(s.expiresAt) > new Date());
    await d.write();
    return sid;
  });
}

export async function getSession(sid) {
  return withLock(async () => {
    const d = ensureDb();
    await d.read();
    const s = d.data.sessions.find(x => x.id === sid);
    if (!s) return null;
    if (new Date(s.expiresAt) < new Date()) {
      d.data.sessions = d.data.sessions.filter(x => x.id !== sid);
      await d.write();
      return null;
    }
    return s;
  });
}

export async function destroySession(sid) {
  return withLock(async () => {
    const d = ensureDb();
    await d.read();
    d.data.sessions = d.data.sessions.filter(x => x.id !== sid);
    await d.write();
  });
}

// ---- Bots ----
export async function createBot(userId, { name } = {}) {
  return withLock(async () => {
    const d = ensureDb();
    await d.read();
    const bot = {
      id: uuidv4(),
      userId,
      name: (name || config.defaultBot.name).trim().slice(0, 64),
      prefix: config.defaultBot.prefix,
      menuTitle: config.defaultBot.menuTitle,
      menuDescription: config.defaultBot.menuDescription,
      footer: config.defaultBot.footer,
      autoRead: config.defaultBot.autoRead,
      presence: config.defaultBot.presence,
      plugins: {}, // { pluginName: true/false }
      status: 'disconnected',
      phoneNumber: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    d.data.bots.push(bot);
    await d.write();
    return bot;
  });
}

export async function getBotById(botId) {
  const d = ensureDb();
  await d.read();
  return d.data.bots.find(b => b.id === botId) || null;
}

export async function getBotsByUser(userId) {
  const d = ensureDb();
  await d.read();
  return d.data.bots.filter(b => b.userId === userId);
}

export async function updateBot(botId, userId, patch) {
  return withLock(async () => {
    const d = ensureDb();
    await d.read();
    const bot = d.data.bots.find(b => b.id === botId && b.userId === userId);
    if (!bot) return null;
    const allowed = [
      'name', 'prefix', 'menuTitle', 'menuDescription', 'footer',
      'autoRead', 'presence', 'plugins', 'status', 'phoneNumber'
    ];
    for (const key of allowed) {
      if (patch[key] !== undefined) bot[key] = patch[key];
    }
    bot.updatedAt = new Date().toISOString();
    await d.write();
    return bot;
  });
}

export async function deleteBot(botId, userId) {
  return withLock(async () => {
    const d = ensureDb();
    await d.read();
    const before = d.data.bots.length;
    d.data.bots = d.data.bots.filter(b => !(b.id === botId && b.userId === userId));
    await d.write();
    return d.data.bots.length < before;
  });
}

export async function getAllBots() {
  const d = ensureDb();
  await d.read();
  return d.data.bots;
}

export default { initDb };
