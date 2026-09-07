import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import config from '../config/index.js'

const SALT_ROUNDS = 10
const TOKEN_TTL = '30d'

export async function hashPassword(plain) {
  return bcrypt.hash(String(plain), SALT_ROUNDS)
}

export async function verifyPassword(plain, hash) {
  if (!hash) return false
  return bcrypt.compare(String(plain), hash)
}

export function signToken(user) {
  return jwt.sign(
    { userId: user.userId, role: user.role },
    config.security.jwtSecret,
    { expiresIn: TOKEN_TTL }
  )
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, config.security.jwtSecret)
  } catch {
    return null
  }
}

const USERNAME_RE = /^[a-z0-9_.]{3,32}$/

export function normalizeUsername(name) {
  return String(name || '').trim().toLowerCase()
}

export function isValidUsername(name) {
  return USERNAME_RE.test(name)
}

export function isValidPassword(pw) {
  return typeof pw === 'string' && pw.length >= 6 && pw.length <= 128
}

export default {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  normalizeUsername,
  isValidUsername,
  isValidPassword,
}
