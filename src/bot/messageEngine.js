import { getPlugins } from './pluginLoader.js';
import logger from '../utils/logger.js';

/**
 * Lightweight message engine.
 * - No global queue
 * - No global lock
 * - Per-message isolated context
 * - Plugin errors are isolated
 * - Instrumentation for latency
 */
export async function processMessage(botSession, rawMsg) {
  const t0 = Date.now();
  const metrics = {
    receivedAt: t0,
    handlerStart: 0,
    pluginStart: 0,
    pluginEnd: 0,
    sendStart: 0,
    sendEnd: 0
  };

  try {
    if (!rawMsg?.message || rawMsg.key?.fromMe) return;

    const msg = extractMessage(rawMsg);
    if (!msg || !msg.text) return;

    metrics.handlerStart = Date.now();

    const prefix = botSession.prefix || '.';
    if (!msg.text.startsWith(prefix)) return;

    const body = msg.text.slice(prefix.length).trim();
    if (!body) return;

    const [cmdName, ...args] = body.split(/\s+/);
    const command = cmdName.toLowerCase();

    const plugins = getPlugins();
    const plugin = plugins.find((p) => {
      if (p.command === command) return true;
      if (Array.isArray(p.aliases) && p.aliases.includes(command)) return true;
      return false;
    });

    if (!plugin) return;

    // Check if plugin disabled for this bot
    const enabledMap = botSession.config.plugins || {};
    if (enabledMap[plugin.command] === false) return;

    const sock = botSession.sock;
    const jid = msg.chat;

    const withMetrics = async (fn) => {
      metrics.sendStart = Date.now();
      try {
        return await fn();
      } finally {
        metrics.sendEnd = Date.now();
      }
    };

    const ctx = {
      bot: botSession,
      sock,
      msg,
      args,
      command,
      prefix,
      raw: rawMsg,
      metrics,
      reply: (text, opts = {}) =>
        withMetrics(() => sock.sendMessage(jid, { text }, opts)),
      sendImage: (media, caption = '', opts = {}) =>
        withMetrics(() => sock.sendImage(jid, media, caption, opts.quoted, opts)),
      sendVideo: (media, caption = '', opts = {}) =>
        withMetrics(() => sock.sendVideo(jid, media, caption, opts.quoted, opts)),
      sendAudio: (media, opts = {}) =>
        withMetrics(() => sock.sendAudio(jid, media, opts)),
      sendVN: (media, opts = {}) =>
        withMetrics(() => sock.sendVN(jid, media, opts.quoted, opts)),
      sendSticker: (media, opts = {}) =>
        withMetrics(() => sock.sendSticker(jid, media, opts.quoted, opts)),
      sendAlbum: (items, opts = {}) =>
        withMetrics(() => sock.sendAlbum(jid, items, opts)),
      sendButton: (content, opts = {}) =>
        withMetrics(() => sock.sendButton(jid, content, opts)),
      sendButtonV2: (content, opts = {}) =>
        withMetrics(() => sock.sendButtonV2(jid, content, opts)),
      sendCarousel: (content, opts = {}) =>
        withMetrics(() => sock.sendCarousel(jid, content, opts))
    };

    metrics.pluginStart = Date.now();
    try {
      await plugin.run(ctx);
    } catch (err) {
      botSession.logger.error(
        { plugin: plugin.command, err: err.message },
        'Plugin execution error'
      );
      try {
        await ctx.reply('Terjadi kesalahan saat menjalankan perintah.');
      } catch {}
    } finally {
      metrics.pluginEnd = Date.now();
    }

    const total = Date.now() - t0;
    if (total > 500) {
      botSession.logger.warn(
        {
          command,
          total,
          wait: metrics.handlerStart - metrics.receivedAt,
          plugin: metrics.pluginEnd - metrics.pluginStart,
          send: metrics.sendEnd - metrics.sendStart
        },
        'Slow command'
      );
    }
  } catch (err) {
    botSession.logger.error({ err: err.message }, 'Message engine error');
  }
}

function extractMessage(raw) {
  const m = raw.message;
  if (!m) return null;

  let text = null;
  if (m.conversation) text = m.conversation;
  else if (m.extendedTextMessage?.text) text = m.extendedTextMessage.text;
  else if (m.imageMessage?.caption) text = m.imageMessage.caption;
  else if (m.videoMessage?.caption) text = m.videoMessage.caption;

  if (!text) return null;

  const chat = raw.key.remoteJid;
  const sender = raw.key.participant || raw.key.remoteJid;
  const isGroup = chat?.endsWith('@g.us');

  return {
    text: text.trim(),
    chat,
    sender,
    isGroup,
    id: raw.key.id,
    pushName: raw.pushName || null
  };
}

export default processMessage;
