import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import SharedFeature from '../../db/models/SharedFeature.js'
import Session from '../../db/models/Session.js'
import configService from '../../core/ConfigService.js'
import logger from '../../utils/logger.js'

function publicFeature(doc) {
  return {
    featureId: doc.featureId,
    title: doc.title,
    description: doc.description || '',
    kind: doc.kind,
    data: doc.data || [],
    active: !!doc.active,
    createdAt: doc.createdAt,
  }
}

function normalizeAutoreplyData(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  const seen = new Set()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const trigger = String(item.trigger || '')
      .trim()
      .toLowerCase()
      .slice(0, 200)
    const reply = String(item.reply || '').trim().slice(0, 2000)
    if (!trigger || !reply) continue
    let scope = String(item.scope || 'all').toLowerCase()
    if (scope !== 'group' && scope !== 'private') scope = 'all'
    const key = `${scope}::${trigger}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ trigger, reply, scope })
    if (out.length >= 50) break
  }
  return out
}

function normalizePluginsData(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const item of raw) {
    if (!item) continue
    if (typeof item === 'string') {
      const file = item.trim()
      if (file) out.push({ file, enabled: true, permissions: [] })
      continue
    }
    if (typeof item === 'object' && item.file) {
      const file = String(item.file).trim()
      if (!file) continue
      out.push({
        file,
        enabled: item.enabled !== false,
        permissions: Array.isArray(item.permissions) ? item.permissions : [],
      })
    }
    if (out.length >= 80) break
  }
  return out
}

export default function createSharedFeatureRoutes() {
  const router = Router()

  /** List fitur gratis aktif (user login) */
  router.get('/', authenticate, async (req, res) => {
    try {
      const list = await SharedFeature.find({ active: true }).sort({ createdAt: -1 }).lean()
      res.json({ features: list.map(publicFeature) })
    } catch (err) {
      logger.error({ err: err.message }, 'List shared features error')
      res.status(500).json({ error: 'Gagal memuat fitur' })
    }
  })

  /** Apply ke session milik user */
  router.post('/:featureId/apply', authenticate, async (req, res) => {
    try {
      const featureId = String(req.params.featureId || '').trim()
      const sessionId = String(req.body?.sessionId || '').trim()
      if (!featureId || !sessionId) {
        return res.status(400).json({ error: 'featureId dan sessionId wajib' })
      }

      const session = await Session.findOne({
        sessionId,
        userId: req.user.userId,
        isActive: true,
      }).lean()
      if (!session) return res.status(404).json({ error: 'Session tidak ditemukan' })

      const feature = await SharedFeature.findOne({ featureId, active: true }).lean()
      if (!feature) return res.status(404).json({ error: 'Fitur tidak ditemukan' })

      await configService.getConfig(sessionId, req.user.userId)

      if (feature.kind === 'autoreply') {
        const incoming = normalizeAutoreplyData(feature.data)
        const cfg = configService.getCached(sessionId)
        const existing = Array.isArray(cfg.autoReplies) ? cfg.autoReplies : []
        const merged = normalizeAutoreplyData([...existing, ...incoming])
        await configService.update(sessionId, req.user.userId, { autoReplies: merged })
        return res.json({
          ok: true,
          kind: 'autoreply',
          applied: incoming.length,
          total: merged.length,
        })
      }

      if (feature.kind === 'plugins') {
        const items = normalizePluginsData(feature.data)
        const states = {}
        for (const it of items) {
          states[it.file] = {
            enabled: it.enabled !== false,
            permissions: it.permissions || [],
          }
        }
        await configService.updatePluginStates(sessionId, req.user.userId, states)
        return res.json({ ok: true, kind: 'plugins', applied: items.length })
      }

      return res.status(400).json({ error: 'Jenis fitur tidak didukung' })
    } catch (err) {
      logger.error({ err: err.message }, 'Apply shared feature error')
      res.status(500).json({ error: err.message || 'Gagal apply fitur' })
    }
  })

  /** Admin list all */
  router.get('/admin/all', authenticate, requireAdmin, async (req, res) => {
    try {
      const list = await SharedFeature.find({}).sort({ createdAt: -1 }).lean()
      res.json({ features: list.map(publicFeature) })
    } catch (err) {
      logger.error({ err: err.message }, 'Admin list shared features error')
      res.status(500).json({ error: 'Gagal memuat fitur' })
    }
  })

  /** Admin create */
  router.post('/admin', authenticate, requireAdmin, async (req, res) => {
    try {
      const title = String(req.body?.title || '').trim().slice(0, 120)
      const description = String(req.body?.description || '').trim().slice(0, 500)
      const kind = req.body?.kind === 'plugins' ? 'plugins' : 'autoreply'
      if (!title) return res.status(400).json({ error: 'Judul wajib' })

      let data = req.body?.data
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data)
        } catch {
          return res.status(400).json({ error: 'Data JSON tidak valid' })
        }
      }
      data = kind === 'plugins' ? normalizePluginsData(data) : normalizeAutoreplyData(data)
      if (!data.length) return res.status(400).json({ error: 'Isi minimal 1 item data' })

      const featureId = `sf_${uuidv4().replace(/-/g, '').slice(0, 16)}`
      const doc = await SharedFeature.create({
        featureId,
        title,
        description,
        kind,
        data,
        active: true,
        createdBy: req.user.userId || 'admin',
      })
      res.status(201).json({ feature: publicFeature(doc) })
    } catch (err) {
      logger.error({ err: err.message }, 'Create shared feature error')
      res.status(500).json({ error: 'Gagal membuat fitur' })
    }
  })

  /** Admin update */
  router.patch('/admin/:featureId', authenticate, requireAdmin, async (req, res) => {
    try {
      const featureId = String(req.params.featureId || '').trim()
      const update = {}
      if (req.body?.title !== undefined) update.title = String(req.body.title).trim().slice(0, 120)
      if (req.body?.description !== undefined)
        update.description = String(req.body.description).trim().slice(0, 500)
      if (req.body?.active !== undefined) update.active = Boolean(req.body.active)
      if (req.body?.kind !== undefined)
        update.kind = req.body.kind === 'plugins' ? 'plugins' : 'autoreply'
      if (req.body?.data !== undefined) {
        let data = req.body.data
        if (typeof data === 'string') data = JSON.parse(data)
        const existing = await SharedFeature.findOne({ featureId }).lean()
        const kind = update.kind || existing?.kind || 'autoreply'
        update.data = kind === 'plugins' ? normalizePluginsData(data) : normalizeAutoreplyData(data)
      }
      const doc = await SharedFeature.findOneAndUpdate({ featureId }, { $set: update }, { new: true })
      if (!doc) return res.status(404).json({ error: 'Tidak ditemukan' })
      res.json({ feature: publicFeature(doc) })
    } catch (err) {
      logger.error({ err: err.message }, 'Patch shared feature error')
      res.status(500).json({ error: 'Gagal update fitur' })
    }
  })

  /** Admin delete */
  router.delete('/admin/:featureId', authenticate, requireAdmin, async (req, res) => {
    try {
      const featureId = String(req.params.featureId || '').trim()
      const r = await SharedFeature.deleteOne({ featureId })
      if (!r.deletedCount) return res.status(404).json({ error: 'Tidak ditemukan' })
      res.json({ ok: true })
    } catch (err) {
      logger.error({ err: err.message }, 'Delete shared feature error')
      res.status(500).json({ error: 'Gagal hapus fitur' })
    }
  })

  return router
}
