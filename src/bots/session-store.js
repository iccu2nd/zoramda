import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config/index.js';

/**
 * Each bot gets its own folder for Baileys' multi-file auth state.
 * Full isolation: one bot's credentials are never readable by another
 * bot's code path, and deleting a bot only touches its own folder.
 */
export function sessionDirFor(botId) {
  const dir = path.join(config.sessionsDir, botId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function deleteSessionDir(botId) {
  const dir = path.join(config.sessionsDir, botId);
  fs.rmSync(dir, { recursive: true, force: true });
}
