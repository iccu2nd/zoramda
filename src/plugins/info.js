export default {
  command: 'info',
  aliases: ['botinfo'],
  category: 'main',
  description: 'Informasi bot',
  async run({ bot, reply }) {
    const uptime = bot.getUptime();
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const s = uptime % 60;
    const upStr = `${h}h ${m}m ${s}s`;

    const text = [
      `*${bot.name}*`,
      `Status: ${bot.status}`,
      `Prefix: ${bot.prefix}`,
      `Nomor: ${bot.phoneNumber || '-'}`,
      `Uptime: ${upStr}`
    ].join('\n');

    await reply(text);
  }
};
