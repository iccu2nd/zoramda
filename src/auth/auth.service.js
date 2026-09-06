import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import { config } from '../config/index.js';
import { usersRepo, sessionsRepo, loginAttemptsRepo } from '../db/repo.js';

const MAX_ATTEMPTS = 8;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

export const authService = {
  async register({ username, password }) {
    username = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,32}$/.test(username)) {
      throw new AuthError('Username must be 3-32 characters: letters, numbers, . _ -', 400);
    }
    if (!password || String(password).length < 8) {
      throw new AuthError('Password must be at least 8 characters', 400);
    }
    if (usersRepo.findByUsername(username)) {
      throw new AuthError('Username is already taken', 409);
    }

    const passwordHash = await bcrypt.hash(String(password), config.bcryptRounds);
    const isFirstUser = usersRepo.countAll() === 0;
    const user = {
      id: nanoid(),
      username,
      passwordHash,
      isAdmin: isFirstUser && config.bootstrapFirstUserAsAdmin,
      createdAt: Date.now()
    };
    usersRepo.create(user);
    return { id: user.id, username: user.username, isAdmin: user.isAdmin };
  },

  async login({ username, password, ip }) {
    username = String(username || '').trim().toLowerCase();
    const now = Date.now();

    loginAttemptsRepo.prune(now - ATTEMPT_WINDOW_MS);
    const recent = loginAttemptsRepo.countRecent({ username, ip, since: now - ATTEMPT_WINDOW_MS });
    if (recent >= MAX_ATTEMPTS) {
      throw new AuthError('Too many login attempts. Try again later.', 429);
    }

    const user = usersRepo.findByUsername(username);
    const valid = user ? await bcrypt.compare(String(password || ''), user.password_hash) : false;

    if (!valid) {
      loginAttemptsRepo.record({ username, ip, createdAt: now });
      throw new AuthError('Invalid username or password', 401);
    }

    const token = newToken();
    sessionsRepo.create({
      token,
      userId: user.id,
      createdAt: now,
      expiresAt: now + config.sessionMaxAgeMs
    });

    return { token, user: { id: user.id, username: user.username, isAdmin: !!user.is_admin } };
  },

  logout(token) {
    if (token) sessionsRepo.destroy(token);
  },

  resolveSession(token) {
    if (!token) return null;
    const session = sessionsRepo.findValid(token, Date.now());
    if (!session) return null;
    const user = usersRepo.findById(session.user_id);
    if (!user) return null;
    return { id: user.id, username: user.username, isAdmin: !!user.is_admin };
  }
};
