import { Router } from 'express';
import { nanoid } from 'nanoid';
import { requireAuth, requireBotOwnership } from '../../auth/auth.middleware.js';
import { asyncHandler } from '../middlewares/errorHandler.js';
import { botsRepo, botPluginsRepo } from '../../db/repo.js';
import { botManager } from '../../bots/bot-manager.js';
import { deleteSessionDir } from '../../bots/session-store.js';
import { listPlugins } from '../../plugins/loader.js';
import { getMenuPreview } from '../../menu/menu.service.js';

export const botsRouter = Router();
botsRouter.use(requireAuth);

function serializeBot(row) {
  const instance = botManager.get(row.id);
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    status: instance?.status || row.status,
    phoneNumber: row.phone_number,
    uptimeMs: instance?.getUptimeMs() || 0,
    menuTitle: row.menu_title,
    menuDescription: row.menu_description,
    menuFooter: row.menu_footer,
    categoryOrder: (() => { try { return JSON.parse(row.category_order || '[]'); } catch { return []; } })(),
    autoRead: !!row.auto_read,
    autoPresence: !!row.auto_presence,
    createdAt: row.created_at,
    qrDataUrl: instance?.qrDataUrl || null,
    pairingCode: instance?.pairingCode || null
  };
}

botsRouter.get('/', (req, res) => {
  const bots = botsRepo.listByUser(req.user.id).map(serializeBot);
  res.json({ bots });
});

botsRouter.post('/', asyncHandler(async (req, res) => {
  const name = String(req.body?.name || 'ZoraBot').trim().slice(0, 64) || 'ZoraBot';
  const prefixRaw = String(req.body?.prefix ?? '.').trim();
  const prefix = prefixRaw.length >= 1 && prefixRaw.length <= 3 ? prefixRaw : '.';

  const bot = botsRepo.create({ id: nanoid(), userId: req.user.id, name, prefix, createdAt: Date.now() });
  res.status(201).json({ bot: serializeBot(bot) });
}));

botsRouter.get('/:botId', requireBotOwnership, (req, res) => {
  res.json({ bot: serializeBot(req.bot) });
});

botsRouter.patch('/:botId', requireBotOwnership, (req, res) => {
  const patch = {};
  const body = req.body || {};
  if (typeof body.name === 'string') patch.name = body.name.trim().slice(0, 64) || 'ZoraBot';
  if (typeof body.prefix === 'string' && body.prefix.length >= 1 && body.prefix.length <= 3) patch.prefix = body.prefix;
  if (typeof body.menuTitle === 'string') patch.menu_title = body.menuTitle.slice(0, 128);
  if (typeof body.menuDescription === 'string') patch.menu_description = body.menuDescription.slice(0, 256);
  if (typeof body.menuFooter === 'string') patch.menu_footer = body.menuFooter.slice(0, 256);
  if (Array.isArray(body.categoryOrder)) patch.category_order = JSON.stringify(body.categoryOrder.map(String).slice(0, 32));
  if (typeof body.autoRead === 'boolean') patch.auto_read = body.autoRead ? 1 : 0;
  if (typeof body.autoPresence === 'boolean') patch.auto_presence = body.autoPresence ? 1 : 0;

  const updated = botsRepo.updateSettings(req.bot.id, patch);
  res.json({ bot: serializeBot(updated) });
});

botsRouter.delete('/:botId', requireBotOwnership, asyncHandler(async (req, res) => {
  await botManager.remove(req.bot.id);
  deleteSessionDir(req.bot.id);
  botsRepo.delete(req.bot.id);
  res.json({ ok: true });
}));

botsRouter.post('/:botId/connect', requireBotOwnership, asyncHandler(async (req, res) => {
  const phoneNumber = typeof req.body?.phoneNumber === 'string' ? req.body.phoneNumber : undefined;
  await botManager.connect(req.bot.id, { pairingPhoneNumber: phoneNumber });
  res.json({ ok: true });
}));

botsRouter.post('/:botId/disconnect', requireBotOwnership, asyncHandler(async (req, res) => {
  await botManager.disconnect(req.bot.id);
  res.json({ ok: true });
}));

botsRouter.post('/:botId/reconnect', requireBotOwnership, asyncHandler(async (req, res) => {
  await botManager.reconnect(req.bot.id);
  res.json({ ok: true });
}));

// Lightweight polling endpoint for the dashboard (status + QR/pairing code).
botsRouter.get('/:botId/status', requireBotOwnership, (req, res) => {
  const bot = botsRepo.findById(req.bot.id);
  res.json({ bot: serializeBot(bot) });
});

botsRouter.get('/:botId/plugins', requireBotOwnership, (req, res) => {
  res.json({ plugins: getMenuPreview(req.bot) });
});

botsRouter.patch('/:botId/plugins/:command', requireBotOwnership, (req, res) => {
  const known = listPlugins().some((p) => p.command === req.params.command);
  if (!known) return res.status(404).json({ error: 'Unknown plugin' });
  const enabled = !!req.body?.enabled;
  botPluginsRepo.setEnabled(req.bot.id, req.params.command, enabled);
  res.json({ ok: true });
});
