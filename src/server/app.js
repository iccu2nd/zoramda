import express from 'express';
import path from 'node:path';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import config from '../config/index.js';
import routes from './routes.js';
import logger from '../utils/logger.js';

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

  app.use(express.static(config.publicDir));

  app.get('*', (req, res) => {
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
