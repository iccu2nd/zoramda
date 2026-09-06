import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGINS_DIR = path.resolve(__dirname, '../plugins');

/** @type {Array<object>} */
let cachedPlugins = [];
let loaded = false;

export async function loadPlugins() {
  const list = [];
  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    cachedPlugins = [];
    loaded = true;
    return cachedPlugins;
  }

  const files = fs.readdirSync(PLUGINS_DIR).filter((f) => f.endsWith('.js'));
  for (const file of files) {
    try {
      const full = path.join(PLUGINS_DIR, file);
      const mod = await import(pathToFileURL(full).href + '?t=' + Date.now());
      const plugin = mod.default || mod;
      if (!plugin || typeof plugin.run !== 'function' || !plugin.command) {
        logger.warn({ file }, 'Invalid plugin skipped');
        continue;
      }
      list.push({
        command: String(plugin.command).toLowerCase(),
        aliases: Array.isArray(plugin.aliases) ? plugin.aliases.map((a) => String(a).toLowerCase()) : [],
        category: plugin.category || 'general',
        description: plugin.description || '',
        permissions: plugin.permissions || [],
        run: plugin.run
      });
    } catch (err) {
      logger.error({ file, err: err.message }, 'Failed to load plugin');
    }
  }

  cachedPlugins = list;
  loaded = true;
  logger.info({ count: list.length }, 'Plugins loaded');
  return cachedPlugins;
}

export function getPlugins() {
  return cachedPlugins;
}

export function getPluginMap() {
  const map = {};
  for (const p of cachedPlugins) {
    map[p.command] = {
      command: p.command,
      aliases: p.aliases,
      category: p.category,
      description: p.description
    };
  }
  return map;
}

export async function reloadPlugins() {
  loaded = false;
  return loadPlugins();
}

export default { loadPlugins, getPlugins, reloadPlugins };
