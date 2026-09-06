import { buildContext } from './context.js';
import { getPlugin } from '../plugins/loader.js';
import { botsRepo, botPluginsRepo } from '../db/repo.js';

/**
 * Handles one `messages.upsert` payload from Baileys. Deliberately does
 * NOT await each message in sequence — every message is dispatched as its
 * own independent async task, so a heavy command in one chat/group can
 * never delay a light command (ping, menu) in another chat, group, or bot.
 * There is no shared queue, no shared lock, and no per-bot serialization
 * point here: concurrency is bounded only by Node's own event loop and by
 * whatever the plugin itself does.
 */
export async function handleIncomingMessages(bot, payload) {
  if (payload.type !== 'notify') return;
  const messages = payload.messages || [];

  for (const waMessage of messages) {
    // Fire-and-forget on purpose — see note above.
    processOne(bot, waMessage).catch((err) => {
      bot.log.error({ err: err.message }, 'unhandled error processing message');
    });
  }
}

async function processOne(bot, waMessage) {
  const receivedAt = Date.now();
  if (!waMessage.message) return; // reactions, protocol messages, etc.
  if (waMessage.key?.fromMe) return; // ignore our own outgoing messages

  const botRow = botsRepo.findById(bot.id);
  if (!botRow) return; // bot was deleted mid-flight

  // Auto-read applies to every incoming message, not just commands — this
  // runs regardless of whether the message turns out to be a command, and
  // never blocks command handling below (fire-and-forget, own try/catch).
  if (botRow.auto_read && waMessage.key) {
    bot.sock?.readMessages([waMessage.key]).catch((err) => {
      bot.log.debug({ err: err.message }, 'auto-read failed');
    });
  }

  const timings = { receivedAt };
  const ctx = buildContext({ bot, botRow, waMessage, timings });

  if (!ctx.command) return; // not a command invocation; base has no passive listeners

  timings.handlerStartAt = Date.now();

  const plugin = getPlugin(ctx.command);
  if (!plugin) return; // unknown command: base stays silent rather than noisy

  const stateMap = botPluginsRepo.getStateMap(bot.id);
  const enabled = stateMap.has(plugin.command) ? stateMap.get(plugin.command) : true;
  if (!enabled) return;

  if (botRow.auto_presence) {
    bot.sock?.sendPresenceUpdate('composing', ctx.jid).catch(() => {});
  }

  timings.pluginStartAt = Date.now();
  await safeRun(ctx, () => plugin.run(ctx));
  timings.pluginEndAt = Date.now();

  if (botRow.auto_presence) {
    bot.sock?.sendPresenceUpdate('paused', ctx.jid).catch(() => {});
  }

  logTimings(bot, ctx, timings);
}

async function safeRun(ctx, fn) {
  try {
    ctx.timings.sendStartAt = Date.now();
    await fn();
    ctx.timings.sendEndAt = Date.now();
  } catch (err) {
    // Plugin errors are isolated here: they never crash the bot or affect
    // other plugins/messages, the user gets a safe generic reply, and the
    // real error (never a stack trace) goes only to the server log.
    ctx.bot.log.error({ err: err.message, command: ctx.command }, 'plugin error');
    try {
      await ctx.reply('Something went wrong running that command.');
    } catch { /* best-effort */ }
  }
}

function logTimings(bot, ctx, t) {
  bot.log.debug({
    command: ctx.command,
    jid: ctx.jid,
    queueWaitMs: t.pluginStartAt ? t.pluginStartAt - t.handlerStartAt : 0,
    pluginMs: t.pluginEndAt ? t.pluginEndAt - t.pluginStartAt : 0,
    sendMs: t.sendEndAt ? t.sendEndAt - t.sendStartAt : 0,
    totalMs: Date.now() - t.receivedAt
  }, 'message processed');
}
