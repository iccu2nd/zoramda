import rateLimit from 'express-rate-limit';

// Applied only to auth endpoints, to blunt brute-force/credential-stuffing.
// This is a security control, not a way to throttle ordinary usage — it
// must never sit in front of anything related to bot messaging.
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
