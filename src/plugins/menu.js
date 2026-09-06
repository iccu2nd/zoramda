import { renderMenu } from '../menu/menu.service.js';

export default {
  command: 'menu',
  aliases: ['help'],
  category: 'General',
  description: 'List available commands',
  async run(ctx) {
    const text = renderMenu(ctx.botRow, ctx.bot.id);
    await ctx.reply(text);
  }
};
