import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** command -> plugin definition */
const registry = new Map();
/** alias -> command */
const aliasMap = new Map();

/**
 * Loads every plugin file in this directory. A plugin is a default export
 * shaped like:
 *   { command, aliases?, category, description, permissions?, run(ctx) }
 * Adding a new plugin means dropping a new file here — the core engine
 * never needs to change.
 */
export async function loadPlugins() {
  registry.clear();
  aliasMap.clear();

  const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.js') && f !== 'loader.js');

  for (const file of files) {
    try {
      const mod = await import(pathToFileURL(path.join(__dirname, file)).href + `?t=${Date.now()}`);
      const plugin = mod.default;
      if (!plugin?.command || typeof plugin.run !== 'function') {
        logger.warn({ file }, 'skipped invalid plugin (missing command or run())');
        continue;
      }
      registry.set(plugin.command, plugin);
      for (const alias of plugin.aliases || []) aliasMap.set(alias.toLowerCase(), plugin.command);
      logger.info({ command: plugin.command }, 'plugin loaded');
    } catch (err) {
      // A broken plugin file must never take down startup or other plugins.
      logger.error({ file, err: err.message }, 'failed to load plugin');
    }
  }
}

export function getPlugin(commandOrAlias) {
  const command = aliasMap.get(commandOrAlias) || commandOrAlias;
  return registry.get(command) || null;
}

export function listPlugins() {
  return [...registry.values()].map((p) => ({
    command: p.command,
    aliases: p.aliases || [],
    category: p.category || 'General',
    description: p.description || ''
  }));
}
