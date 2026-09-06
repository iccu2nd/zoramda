import { getPlugins } from '../bot/pluginLoader.js';

export default {
  command: 'menu',
  aliases: ['help', 'list'],
  category: 'main',
  description: 'Tampilkan daftar perintah',
  async run({ bot, reply, prefix }) {
    const plugins = getPlugins();
    const enabledMap = bot.config.plugins || {};

    const byCategory = {};
    for (const p of plugins) {
      if (enabledMap[p.command] === false) continue;
      const cat = p.category || 'general';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(p);
    }

    const title = bot.config.menuTitle || bot.name || 'Menu';
    const desc = bot.config.menuDescription || '';
    const footer = bot.config.footer || '';

    let text = `*${title}*\n`;
    if (desc) text += `${desc}\n`;
    text += `\nPrefix: \`${prefix}\`\n`;

    const cats = Object.keys(byCategory).sort();
    for (const cat of cats) {
      text += `\n*${cat.toUpperCase()}*\n`;
      for (const p of byCategory[cat].sort((a, b) => a.command.localeCompare(b.command))) {
        text += `  ${prefix}${p.command}`;
        if (p.description) text += ` — ${p.description}`;
        text += '\n';
      }
    }

    if (footer) text += `\n${footer}`;
    await reply(text.trim());
  }
};
