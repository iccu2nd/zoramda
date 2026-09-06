import { listPlugins } from '../plugins/loader.js';
import { botPluginsRepo } from '../db/repo.js';

function parseCategoryOrder(json) {
  try {
    const arr = JSON.parse(json || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * Renders the menu text for a bot. Only plugins that are actually loaded
 * AND enabled for this bot appear — a disabled or missing plugin is never
 * listed, so the menu never advertises something the bot can't do.
 */
export function renderMenu(botRow) {
  const all = listPlugins();
  const stateMap = botPluginsRepo.getStateMap(botRow.id);
  const enabled = all.filter((p) => (stateMap.has(p.command) ? stateMap.get(p.command) : true));

  const byCategory = new Map();
  for (const plugin of enabled) {
    const cat = plugin.category || 'General';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(plugin);
  }

  const preferredOrder = parseCategoryOrder(botRow.category_order);
  const categories = [...byCategory.keys()].sort((a, b) => {
    const ai = preferredOrder.indexOf(a);
    const bi = preferredOrder.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const lines = [];
  lines.push(botRow.menu_title || 'Menu');
  if (botRow.menu_description) lines.push(botRow.menu_description);
  lines.push('');

  for (const cat of categories) {
    lines.push(`${cat}`);
    for (const plugin of byCategory.get(cat)) {
      lines.push(`${botRow.prefix}${plugin.command} - ${plugin.description}`);
    }
    lines.push('');
  }

  if (botRow.menu_footer) lines.push(botRow.menu_footer);

  return lines.join('\n').trim();
}

/** Structured version for the dashboard's menu preview panel. */
export function getMenuPreview(botRow) {
  const all = listPlugins();
  const stateMap = botPluginsRepo.getStateMap(botRow.id);
  return all.map((p) => ({
    ...p,
    enabled: stateMap.has(p.command) ? stateMap.get(p.command) : true
  }));
}
