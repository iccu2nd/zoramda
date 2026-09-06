import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

// A single persistent connection is the correct pattern for SQLite (it is an
// embedded, single-process database — a traditional connection *pool* like
// you'd use for Postgres/MySQL does not apply). WAL mode lets reads and
// writes proceed concurrently without blocking the event loop's callers,
// which is what actually matters for the "connection pooling" requirement
// here: no connection is opened per-message, and access is serialized safely.
export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

logger.info({ dbPath: config.dbPath }, 'database ready');

process.on('exit', () => {
  try { db.close(); } catch { /* noop */ }
});
