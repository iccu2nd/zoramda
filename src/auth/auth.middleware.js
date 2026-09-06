import { authService } from './auth.service.js';
import { botsRepo } from '../db/repo.js';

const COOKIE_NAME = 'zora_session';
export const SESSION_COOKIE_NAME = COOKIE_NAME;

export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  const user = authService.resolveSession(token);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  req.user = user;
  req.sessionToken = token;
  next();
}

/**
 * Loads the :botId param, verifies it exists and belongs to req.user, and
 * attaches it as req.bot. Must run after requireAuth. This is the single
 * choke point that guarantees a user can never touch another user's bot,
 * session, or configuration.
 */
export function requireBotOwnership(req, res, next) {
  const bot = botsRepo.findById(req.params.botId || req.params.id);
  if (!bot || bot.user_id !== req.user.id) {
    // Same response whether the bot doesn't exist or belongs to someone
    // else, so ownership can't be probed by id.
    return res.status(404).json({ error: 'Bot not found' });
  }
  req.bot = bot;
  next();
}
