import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import cors from 'cors'
import helmet from 'helmet'
import config from '../config/index.js'
import logger from '../utils/logger.js'
import healthRoutes from './routes/health.js'
import createSessionRoutes from './routes/sessions.js'
import authRoutes from './routes/auth.js'
import createConfigRoutes from './routes/config.js'
import createPluginRoutes from './routes/plugins.js'
import createAdminRoutes from './routes/admin.js'
import paymentRoutes from './routes/payment.js'

/**
 * @param {import('../core/SessionManager.js').SessionManager} sessionManager
 */
export function createServer(sessionManager) {
  const app = express()
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const publicDir = join(__dirname, '../../public')

  app.use(helmet({ contentSecurityPolicy: false }))
  app.use(cors({ origin: true, credentials: true }))
  app.use(express.json({ limit: '1mb' }))

  // Static UI
  app.use(express.static(publicDir, { index: false, maxAge: config.isProd ? '1h' : 0 }))
  app.get('/', (req, res) => res.sendFile(join(publicDir, 'index.html')))
  // legacy /app → /dash
  app.get('/app', (req, res) => res.redirect(301, '/dash'))
  app.get(/^\/app(\/.*)?$/, (req, res) => res.redirect(301, '/dash'))
  app.get('/login', (req, res) => res.sendFile(join(publicDir, 'app.html')))
  app.get('/dash', (req, res) => res.sendFile(join(publicDir, 'app.html')))
  app.get(/^\/dash(\/.*)?$/, (req, res) => res.sendFile(join(publicDir, 'app.html')))

  // Request logging (lightweight)
  app.use((req, res, next) => {
    const start = Date.now()
    res.on('finish', () => {
      if (req.path !== '/health' && req.path !== '/ready') {
        logger.debug(
          { method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start },
          'HTTP'
        )
      }
    })
    next()
  })

  app.use(healthRoutes)
  app.use('/api/auth', authRoutes)
  app.use('/api/config', createConfigRoutes(sessionManager))
  app.use('/api/plugins', createPluginRoutes(sessionManager))
  app.use('/api/sessions', createSessionRoutes(sessionManager))
  app.use('/api/admin', createAdminRoutes(sessionManager))
  app.use('/api/payment', paymentRoutes)

  // 404
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' })
  })

  // Error handler – never leak stack in production
  app.use((err, req, res, next) => {
    logger.error({ err: err.message, path: req.path }, 'Unhandled API error')
    res.status(500).json({
      error: config.isProd ? 'Internal server error' : err.message,
    })
  })

  return app
}

export default createServer
