-- ZoraBot base schema. Kept intentionally small: only what the base
-- feature set needs. Add tables as real features are added, not ahead of time.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

-- Server-side session store. Cookies only carry an opaque random token;
-- this table is the source of truth and lets us revoke sessions instantly.
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Failed login attempts, for brute-force protection (kept small & pruned).
CREATE TABLE IF NOT EXISTS login_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT NOT NULL,
  ip         TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_lookup ON login_attempts(username, created_at);

CREATE TABLE IF NOT EXISTS bots (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL DEFAULT 'ZoraBot',
  prefix            TEXT NOT NULL DEFAULT '.',
  status            TEXT NOT NULL DEFAULT 'disconnected', -- disconnected|connecting|connected
  phone_number      TEXT,
  menu_title        TEXT NOT NULL DEFAULT 'ZoraBot Menu',
  menu_description  TEXT NOT NULL DEFAULT 'Available commands',
  menu_footer       TEXT NOT NULL DEFAULT '',
  category_order    TEXT NOT NULL DEFAULT '[]', -- JSON array of category names
  auto_read         INTEGER NOT NULL DEFAULT 0,
  auto_presence     INTEGER NOT NULL DEFAULT 0,
  connected_at      INTEGER,
  created_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bots_user ON bots(user_id);

-- Per-bot enable/disable state for each known plugin command.
-- Absence of a row means "enabled" (default-on) unless explicitly disabled.
CREATE TABLE IF NOT EXISTS bot_plugins (
  bot_id  TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  command TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (bot_id, command)
);
