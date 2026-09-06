import { db } from './index.js';

/* ---------------------------- users --------------------------------- */

export const usersRepo = {
  countAll() {
    return db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  },
  findByUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  },
  findById(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  },
  create({ id, username, passwordHash, isAdmin, createdAt }) {
    db.prepare(
      'INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, username, passwordHash, isAdmin ? 1 : 0, createdAt);
  }
};

/* --------------------------- sessions -------------------------------- */

export const sessionsRepo = {
  create({ token, userId, createdAt, expiresAt }) {
    db.prepare(
      'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).run(token, userId, createdAt, expiresAt);
  },
  findValid(token, now) {
    return db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?').get(token, now);
  },
  destroy(token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  },
  destroyAllForUser(userId) {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  },
  pruneExpired(now) {
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  }
};

/* ------------------------ login attempts ------------------------------ */

export const loginAttemptsRepo = {
  record({ username, ip, createdAt }) {
    db.prepare('INSERT INTO login_attempts (username, ip, created_at) VALUES (?, ?, ?)')
      .run(username, ip, createdAt);
  },
  countRecent({ username, ip, since }) {
    return db
      .prepare('SELECT COUNT(*) AS c FROM login_attempts WHERE (username = ? OR ip = ?) AND created_at > ?')
      .get(username, ip, since).c;
  },
  prune(before) {
    db.prepare('DELETE FROM login_attempts WHERE created_at < ?').run(before);
  }
};

/* ------------------------------ bots ---------------------------------- */

export const botsRepo = {
  create({ id, userId, name, prefix, createdAt }) {
    db.prepare(
      'INSERT INTO bots (id, user_id, name, prefix, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, userId, name, prefix, createdAt);
    return this.findById(id);
  },
  findById(id) {
    return db.prepare('SELECT * FROM bots WHERE id = ?').get(id);
  },
  listByUser(userId) {
    return db.prepare('SELECT * FROM bots WHERE user_id = ? ORDER BY created_at ASC').all(userId);
  },
  updateStatus(id, status, extra = {}) {
    const fields = ['status = @status'];
    const params = { id, status };
    if (extra.phoneNumber !== undefined) { fields.push('phone_number = @phoneNumber'); params.phoneNumber = extra.phoneNumber; }
    if (extra.connectedAt !== undefined) { fields.push('connected_at = @connectedAt'); params.connectedAt = extra.connectedAt; }
    db.prepare(`UPDATE bots SET ${fields.join(', ')} WHERE id = @id`).run(params);
  },
  updateSettings(id, patch) {
    const allowed = ['name', 'prefix', 'menu_title', 'menu_description', 'menu_footer', 'category_order', 'auto_read', 'auto_presence'];
    const fields = [];
    const params = { id };
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        fields.push(`${key} = @${key}`);
        params[key] = patch[key];
      }
    }
    if (fields.length === 0) return this.findById(id);
    db.prepare(`UPDATE bots SET ${fields.join(', ')} WHERE id = @id`).run(params);
    return this.findById(id);
  },
  delete(id) {
    db.prepare('DELETE FROM bots WHERE id = ?').run(id);
  }
};

/* --------------------------- bot plugins ------------------------------- */

export const botPluginsRepo = {
  getStateMap(botId) {
    const rows = db.prepare('SELECT command, enabled FROM bot_plugins WHERE bot_id = ?').all(botId);
    const map = new Map();
    for (const row of rows) map.set(row.command, !!row.enabled);
    return map;
  },
  setEnabled(botId, command, enabled) {
    db.prepare(
      `INSERT INTO bot_plugins (bot_id, command, enabled) VALUES (?, ?, ?)
       ON CONFLICT(bot_id, command) DO UPDATE SET enabled = excluded.enabled`
    ).run(botId, command, enabled ? 1 : 0);
  }
};
