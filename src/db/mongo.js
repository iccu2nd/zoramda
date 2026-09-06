import { MongoClient } from 'mongodb';
import config from '../config/index.js';
import logger from '../utils/logger.js';

let client = null;
let db = null;

/**
 * Connect to MongoDB (idempotent). The database name is taken from the
 * connection string itself (…mongodb.net/zorabot?...).
 */
export async function connectMongo() {
  if (db) return db;
  if (!config.mongoUri) {
    throw new Error('MONGODB_URI is not set (check your .env file)');
  }
  client = new MongoClient(config.mongoUri);
  await client.connect();
  db = client.db();
  logger.info('MongoDB connected');
  return db;
}

export async function getDb() {
  if (!db) await connectMongo();
  return db;
}

let authIndexesReady = false;
let loginIndexesReady = false;
let lockIndexesReady = false;
let usersIndexesReady = false;
let botsIndexesReady = false;

/**
 * Collection storing Baileys auth state (creds + signal keys) per bot/user session.
 * One document per (sessionId, dataId) pair, e.g. dataId "creds" or "app-state-sync-key-XYZ".
 */
export async function getAuthCollection() {
  const database = await getDb();
  const col = database.collection('bot_auth_state');
  if (!authIndexesReady) {
    await col.createIndex({ sessionId: 1, dataId: 1 }, { unique: true });
    authIndexesReady = true;
  }
  return col;
}

/**
 * Collection storing web login sessions (replaces the old lowdb "sessions" array).
 * A TTL index automatically removes documents once they expire.
 */
export async function getLoginSessionsCollection() {
  const database = await getDb();
  const col = database.collection('login_sessions');
  if (!loginIndexesReady) {
    await col.createIndex({ id: 1 }, { unique: true });
    await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    loginIndexesReady = true;
  }
  return col;
}

/**
 * Collection used as a lease-based lock so only one running process ever
 * holds a given bot's live WhatsApp connection — needed because Railway's
 * rolling deploys briefly run the old and new container at the same time.
 */
export async function getLocksCollection() {
  const database = await getDb();
  const col = database.collection('bot_locks');
  if (!lockIndexesReady) {
    await col.createIndex({ botId: 1 }, { unique: true });
    await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    lockIndexesReady = true;
  }
  return col;
}

/**
 * Collection storing user accounts (replaces the old lowdb "users" array,
 * which lived on Railway's ephemeral disk and was wiped on every redeploy).
 */
export async function getUsersCollection() {
  const database = await getDb();
  const col = database.collection('users');
  if (!usersIndexesReady) {
    await col.createIndex({ usernameLower: 1 }, { unique: true });
    await col.createIndex({ id: 1 }, { unique: true });
    usersIndexesReady = true;
  }
  return col;
}

/**
 * Collection storing bot records/config (replaces the old lowdb "bots" array).
 */
export async function getBotsCollection() {
  const database = await getDb();
  const col = database.collection('bots');
  if (!botsIndexesReady) {
    await col.createIndex({ id: 1 }, { unique: true });
    await col.createIndex({ userId: 1 });
    botsIndexesReady = true;
  }
  return col;
}

export async function closeMongo() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

export default {
  connectMongo,
  getDb,
  getAuthCollection,
  getLoginSessionsCollection,
  getLocksCollection,
  getUsersCollection,
  getBotsCollection,
  closeMongo
};
