import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import {
  connectMongo,
  getLoginSessionsCollection,
  getUsersCollection,
  getBotsCollection
} from './mongo.js';

export async function initDb() {
  await connectMongo();
  logger.info('Database initialized');
}

// ---- Users ----
export async function createUser({ username, password }) {
  const col = await getUsersCollection();
  const usernameLower = username.trim().toLowerCase();
  const existing = await col.findOne({ usernameLower });
  if (existing) {
    throw new Error('Username already exists');
  }
  const hash = await bcrypt.hash(password, 12);
  const user = {
    id: uuidv4(),
    username: username.trim(),
    usernameLower,
    passwordHash: hash,
    createdAt: new Date().toISOString()
  };
  await col.insertOne(user);
  return { id: user.id, username: user.username, createdAt: user.createdAt };
}

export async function findUserByUsername(username) {
  const col = await getUsersCollection();
  return col.findOne({ usernameLower: username.trim().toLowerCase() });
}

export async function findUserById(id) {
  const col = await getUsersCollection();
  return col.findOne({ id });
}

export async function verifyPassword(user, password) {
  return bcrypt.compare(password, user.passwordHash);
}

// ---- Auth Sessions (web) — stored in MongoDB ----
export async function createSession(userId) {
  const col = await getLoginSessionsCollection();
  const sid = uuidv4();
  await col.insertOne({
    id: sid,
    userId,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + config.cookie.maxAge)
  });
  return sid;
}

export async function getSession(sid) {
  const col = await getLoginSessionsCollection();
  const session = await col.findOne({ id: sid });
  if (!session) return null;
  if (new Date(session.expiresAt) < new Date()) {
    await col.deleteOne({ id: sid });
    return null;
  }
  return session;
}

export async function destroySession(sid) {
  const col = await getLoginSessionsCollection();
  await col.deleteOne({ id: sid });
}

// ---- Bots ----
export async function createBot(userId, { name } = {}) {
  const col = await getBotsCollection();
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
  await col.insertOne(bot);
  return bot;
}

export async function getBotById(botId) {
  const col = await getBotsCollection();
  return col.findOne({ id: botId });
}

export async function getBotsByUser(userId) {
  const col = await getBotsCollection();
  return col.find({ userId }).toArray();
}

export async function updateBot(botId, userId, patch) {
  const col = await getBotsCollection();
  const allowed = [
    'name', 'prefix', 'menuTitle', 'menuDescription', 'footer',
    'autoRead', 'presence', 'plugins', 'status', 'phoneNumber'
  ];
  const set = { updatedAt: new Date().toISOString() };
  for (const key of allowed) {
    if (patch[key] !== undefined) set[key] = patch[key];
  }
  const result = await col.findOneAndUpdate(
    { id: botId, userId },
    { $set: set },
    { returnDocument: 'after' }
  );
  // mongodb driver v6 returns the document directly; older versions wrap it in { value }
  return result?.value ?? result ?? null;
}

export async function deleteBot(botId, userId) {
  const col = await getBotsCollection();
  const result = await col.deleteOne({ id: botId, userId });
  return result.deletedCount > 0;
}

export async function getAllBots() {
  const col = await getBotsCollection();
  return col.find({}).toArray();
}

export default { initDb };
