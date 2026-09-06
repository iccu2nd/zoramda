export default {
  command: 'ping',
  aliases: ['p'],
  category: 'main',
  description: 'Cek kecepatan respon bot',
  async run({ reply, metrics }) {
    const latency = Date.now() - (metrics?.receivedAt || Date.now());
    await reply(`Pong\nLatency: ${latency}ms`);
  }
};
