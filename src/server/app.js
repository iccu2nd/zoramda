import express from 'express';
import path from 'node:path';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import config from '../config/index.js';
import routes from './routes.js';
import logger from '../utils/logger.js';

// Clean URL -> actual file in /public. Add new pages here (no .html in the URL).
const PAGE_MAP = {
  '/': 'index.html',
  '/connect': 'connect.html'
};

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: false
  }));
  app.use(cors({
    origin: true,
    credentials: true
  }));
  app.use(express.json({ limit: '64kb' }));
  app.use(cookieParser());
  app.use(rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false
  }));

  app.use('/api', routes);

  // Static assets
  app.use('/css', express.static(path.join(config.publicDir, 'css'), { maxAge: '7d', etag: true }));
  app.use('/js', express.static(path.join(config.publicDir, 'js'), { maxAge: '7d', etag: true }));
  app.use('/assets', express.static(path.join(config.publicDir, 'assets'), { maxAge: '7d', etag: true }));

  // Clean page routes (no .html in the URL)
  for (const [route, file] of Object.entries(PAGE_MAP)) {
    app.get(route, (req, res) => {
      res.sendFile(path.join(config.publicDir, file));
    });
  }

  // Old-style /page.html links still work, but redirect to the clean URL
  app.get(/^\/([a-z0-9-]+)\.html$/i, (req, res) => {
    const base = '/' + req.params[0];
    if (PAGE_MAP[base]) return res.redirect(301, base);
    if (req.params[0] === 'index') return res.redirect(301, '/');
    return res.sendFile(path.join(config.publicDir, 'index.html'));
  });

  app.use(express.static(config.publicDir));

  // SPA fallback for any other client-side route
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
    res.sendFile(path.join(config.publicDir, 'index.html'));
  });

  app.use((err, req, res, next) => {
    logger.error({ err: err.message, path: req.path }, 'API error');
    res.status(err.status || 500).json({
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
    });
  });

  return app;
}

export default createApp;
