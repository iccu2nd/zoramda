import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  createUser,
  findUserByUsername,
  verifyPassword,
  createSession,
  destroySession,
  createBot,
  getBotById,
  getBotsByUser,
  updateBot,
  deleteBot
} from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import botManager from '../bot/manager.js';
import { getPlugins, getPluginMap, reloadPlugins } from '../bot/pluginLoader.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: config.loginRateLimit.windowMs,
  max: config.loginRateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts' }
});

// ---- Auth ----
router.post('/auth/register', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || typeof username !== 'string' || username.trim().length < 3) {
      return res.status(400).json({ error: 'Username minimal 3 karakter' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password minimal 6 karakter' });
    }
    const user = await createUser({ username: username.trim(), password });
    const sid = await createSession(user.id);
    res.cookie(config.cookie.name, sid, {
      maxAge: config.cookie.maxAge,
      httpOnly: config.cookie.httpOnly,
      sameSite: config.cookie.sameSite,
      secure: config.cookie.secure
    });
    res.json({ user: { id: user.id, username: user.username } });
  } catch (err) {
    if (err.message === 'Username already exists') {
      return res.status(409).json({ error: err.message });
    }
    next(err);
  }
});

router.post('/auth/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username dan password wajib' });
    }
    const user = await findUserByUsername(username);
    if (!user || !(await verifyPassword(user, password))) {
      return res.status(401).json({ error: 'Username atau password salah' });
    }
    const sid = await createSession(user.id);
    res.cookie(config.cookie.name, sid, {
      maxAge: config.cookie.maxAge,
      httpOnly: config.cookie.httpOnly,
      sameSite: config.cookie.sameSite,
      secure: config.cookie.secure
    });
    res.json({ user: { id: user.id, username: user.username } });
  } catch (err) {
    next(err);
  }
});

router.post('/auth/logout', requireAuth, async (req, res, next) => {
  try {
    await destroySession(req.sessionId);
    res.clearCookie(config.cookie.name);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ---- Bots ----
router.get('/bots', requireAuth, async (req, res, next) => {
  try {
    const bots = await botManager.getUserBotsState(req.user.id);
    res.json({ bots });
  } catch (err) {
    next(err);
  }
});

router.post('/bots', requireAuth, async (req, res, next) => {
  try {
    const name = (req.body?.name || config.defaultBot.name).toString().trim().slice(0, 64);
    const bot = await createBot(req.user.id, { name });
    res.status(201).json({ bot });
  } catch (err) {
    next(err);
  }
});

router.get('/bots/:id', requireAuth, async (req, res, next) => {
  try {
    const record = await getBotById(req.params.id);
    if (!record || record.userId !== req.user.id) {
      return res.status(404).json({ error: 'Bot not found' });
    }
    const live = botManager.getPublicState(req.params.id);
    res.json({ bot: live || {
      id: record.id,
      name: record.name,
      prefix: record.prefix,
      status: record.status || 'disconnected',
      phoneNumber: record.phoneNumber,
      uptime: 0,
      qr: null,
      menuTitle: record.menuTitle,
      menuDescription: record.menuDescription,
      footer: record.footer,
      autoRead: record.autoRead,
      presence: record.presence,
      plugins: record.plugins || {}
    }});
  } catch (err) {
    next(err);
  }
});

router.patch('/bots/:id', requireAuth, async (req, res, next) => {
  try {
    const record = await getBotById(req.params.id);
    if (!record || record.userId !== req.user.id) {
      return res.status(404).json({ error: 'Bot not found' });
    }
    const allowed = ['name', 'prefix', 'menuTitle', 'menuDescription', 'footer', 'autoRead', 'presence', 'plugins'];
    const patch = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    }
    if (patch.name) patch.name = String(patch.name).trim().slice(0, 64);
    if (patch.prefix !== undefined) patch.prefix = String(patch.prefix).slice(0, 5) || '.';

    const updated = await updateBot(req.params.id, req.user.id, patch);
    const session = botManager.getBot(req.params.id);
    if (session) {
      await session.updateConfig(patch);
    }
    res.json({ bot: updated });
  } catch (err) {
    next(err);
  }
});

router.delete('/bots/:id', requireAuth, async (req, res, next) => {
  try {
    const record = await getBotById(req.params.id);
    if (!record || record.userId !== req.user.id) {
      return res.status(404).json({ error: 'Bot not found' });
    }
    await botManager.stopBot(req.params.id);
    await deleteBot(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/bots/:id/connect', requireAuth, async (req, res, next) => {
  try {
    const record = await getBotById(req.params.id);
    if (!record || record.userId !== req.user.id) {
      return res.status(404).json({ error: 'Bot not found' });
    }
    const method = req.body?.method === 'pairing' ? 'pairing' : 'qr';
    const phone = req.body?.phone;
    if (method === 'pairing') {
      const digits = String(phone || '').replace(/\D/g, '');
      if (digits.length < 8 || digits.length > 15) {
        return res.status(400).json({
          error: 'Nomor tidak valid. Gunakan kode negara + nomor (hanya angka), contoh: 6281234567890'
        });
      }
    }
    const session = await botManager.startBot(req.params.id, { method, phone });
    res.json({ bot: session.getPublicState() });
  } catch (err) {
    if (err.message?.includes('Nomor wajib')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

router.post('/bots/:id/disconnect', requireAuth, async (req, res, next) => {
  try {
    const record = await getBotById(req.params.id);
    if (!record || record.userId !== req.user.id) {
      return res.status(404).json({ error: 'Bot not found' });
    }
    await botManager.stopBot(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/bots/:id/reconnect', requireAuth, async (req, res, next) => {
  try {
    const record = await getBotById(req.params.id);
    if (!record || record.userId !== req.user.id) {
      return res.status(404).json({ error: 'Bot not found' });
    }
    const session = await botManager.reconnectBot(req.params.id);
    res.json({ bot: session.getPublicState() });
  } catch (err) {
    next(err);
  }
});

// ---- Plugins meta ----
router.get('/plugins', requireAuth, (req, res) => {
  res.json({ plugins: getPluginMap() });
});

router.post('/plugins/reload', requireAuth, async (req, res, next) => {
  try {
    await reloadPlugins();
    res.json({ plugins: getPluginMap() });
  } catch (err) {
    next(err);
  }
});

export default router;
