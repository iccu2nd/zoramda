import 'dotenv/config';
import path from 'node:path';

const root = process.cwd();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  isProd: process.env.NODE_ENV === 'production',
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  sessionMaxAgeMs: (parseInt(process.env.SESSION_MAX_AGE_HOURS || '168', 10)) * 60 * 60 * 1000,
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
  dbPath: path.resolve(root, process.env.DB_PATH || './data/zorabot.db'),
  sessionsDir: path.resolve(root, process.env.SESSIONS_DIR || './sessions'),
  bootstrapFirstUserAsAdmin: (process.env.BOOTSTRAP_FIRST_USER_AS_ADMIN || 'true') === 'true'
};
