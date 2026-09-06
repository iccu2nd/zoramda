export default {
  command: 'ping',
  aliases: [],
  category: 'General',
  description: 'Check whether the bot is responding',
  async run(ctx) {
    const ms = Date.now() - ctx.timings.receivedAt;
    await ctx.reply(`Pong. ${ms}ms`);
  }
};
