import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

export const config = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  sessionSecret: process.env.SESSION_SECRET || 'zorabot-change-me-in-production-' + Date.now(),
  mongoUri: process.env.MONGODB_URI || '',
  dataDir: path.join(ROOT, 'data'),
  sessionsDir: path.join(ROOT, 'sessions'),
  logsDir: path.join(ROOT, 'logs'),
  publicDir: path.join(ROOT, 'public'),
  cookie: {
    name: 'zora_sid',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  },
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 100
  },
  loginRateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 20
  },
  defaultBot: {
    name: 'ZoraBot',
    prefix: '.',
    menuTitle: 'ZoraBot Menu',
    menuDescription: 'Command list',
    footer: 'ZoraBot Base',
    autoRead: false,
    presence: false
  }
};

export default config;
