import { Router } from 'express'
import mongoose from 'mongoose'

const router = Router()

router.get('/health', (req, res) => {
  const mongoState = mongoose.connection.readyState
  // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
  const healthy = mongoState === 1

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    mongo: ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoState] || 'unknown',
  })
})

router.get('/ready', (req, res) => {
  if (mongoose.connection.readyState === 1) {
    return res.status(200).json({ ready: true })
  }
  res.status(503).json({ ready: false })
})

export default router
