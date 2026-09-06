function extractText(message) {
  if (!message) return '';
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    ''
  );
}

/**
 * Builds a per-message context object. Nothing here is stored on shared
 * state (no `currentChat`/`currentGroup` globals) — every value is derived
 * fresh from the message being handled, so concurrent messages from
 * different chats/groups/bots never see each other's data.
 */
export function buildContext({ bot, botRow, waMessage, timings }) {
  const key = waMessage.key || {};
  const jid = key.remoteJid || '';
  const isGroup = jid.endsWith('@g.us');
  const sender = isGroup ? (key.participant || jid) : jid;
  const text = extractText(waMessage.message).trim();
  const prefix = botRow.prefix || '.';

  let command = null;
  let args = [];
  let rawArgs = '';
  if (text.startsWith(prefix) && text.length > prefix.length) {
    const body = text.slice(prefix.length).trim();
    const parts = body.split(/\s+/);
    command = parts.shift()?.toLowerCase() || null;
    args = parts;
    rawArgs = body.slice(command ? command.length : 0).trim();
  }

  return {
    bot,
    botId: bot.id,
    botRow,
    jid,
    sender,
    isGroup,
    text,
    prefix,
    command,
    args,
    rawArgs,
    fromMe: !!key.fromMe,
    messageId: key.id,
    raw: waMessage,
    timings,
    async reply(content) {
      if (!bot.sock) return;
      const payload = typeof content === 'string' ? { text: content } : content;
      await bot.sock.sendMessage(jid, payload, { quoted: waMessage });
    }
  };
}
