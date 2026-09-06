import { Router } from 'express';
import { authService } from '../../auth/auth.service.js';
import { requireAuth, SESSION_COOKIE_NAME } from '../../auth/auth.middleware.js';
import { asyncHandler } from '../middlewares/errorHandler.js';
import { authRateLimiter } from '../middlewares/rateLimit.js';
import { config } from '../../config/index.js';

export const authRouter = Router();

function cookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    maxAge: config.sessionMaxAgeMs,
    path: '/'
  };
}

authRouter.post('/register', authRateLimiter, asyncHandler(async (req, res) => {
  const user = await authService.register(req.body || {});
  res.status(201).json({ user });
}));

authRouter.post('/login', authRateLimiter, asyncHandler(async (req, res) => {
  const { token, user } = await authService.login({ ...(req.body || {}), ip: req.ip });
  res.cookie(SESSION_COOKIE_NAME, token, cookieOptions());
  res.json({ user });
}));

authRouter.post('/logout', requireAuth, (req, res) => {
  authService.logout(req.sessionToken);
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});
