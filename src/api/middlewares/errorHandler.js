import { logger } from '../../utils/logger.js';

export function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  if (status >= 500) {
    logger.error({ err: err.message, path: req.path }, 'unhandled request error');
  }
  // Generic message only — no stack traces, no internal details, ever.
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Not found' });
}
