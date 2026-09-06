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

/**
 * Collection storing Baileys auth state (creds + signal keys) per bot/user session.
 * One document per (sessionId, dataId) pair, e.g. dataId "creds" or "app-state-sync-key-XYZ".
 */
export async function getAuthCollection() {
  const database = await getDb();
  const col = database.collection('bot_auth_state');
  await col.createIndex({ sessionId: 1, dataId: 1 }, { unique: true });
  return col;
}

/**
 * Collection storing web login sessions (replaces the old lowdb "sessions" array).
 * A TTL index automatically removes documents once they expire.
 */
export async function getLoginSessionsCollection() {
  const database = await getDb();
  const col = database.collection('login_sessions');
  await col.createIndex({ id: 1 }, { unique: true });
  await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
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
  closeMongo
};
