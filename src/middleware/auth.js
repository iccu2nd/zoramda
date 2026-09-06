import { getSession, findUserById } from '../db/index.js';
import config from '../config/index.js';

export async function requireAuth(req, res, next) {
  try {
    const sid = req.cookies?.[config.cookie.name];
    if (!sid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const session = await getSession(sid);
    if (!session) {
      res.clearCookie(config.cookie.name);
      return res.status(401).json({ error: 'Session expired' });
    }
    const user = await findUserById(session.userId);
    if (!user) {
      res.clearCookie(config.cookie.name);
      return res.status(401).json({ error: 'User not found' });
    }
    req.user = { id: user.id, username: user.username };
    req.sessionId = sid;
    next();
  } catch (err) {
    next(err);
  }
}

export function optionalAuth(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err || !req.user) {
      req.user = null;
    }
    next();
  });
}
