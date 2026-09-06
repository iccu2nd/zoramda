export default {
  command: 'info',
  aliases: ['about'],
  category: 'General',
  description: 'Show basic information about this bot',
  async run(ctx) {
    const uptimeMs = ctx.bot.getUptimeMs();
    const minutes = Math.floor(uptimeMs / 60000);
    await ctx.reply(
      `${ctx.botRow.name}\nPrefix: ${ctx.botRow.prefix}\nUptime: ${minutes} minute(s)`
    );
  }
};
