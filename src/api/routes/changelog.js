import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import Changelog from '../../db/models/Changelog.js'
import logger from '../../utils/logger.js'

function publicEntry(doc) {
  return {
    entryId: doc.entryId,
    version: doc.version || '',
    title: doc.title,
    body: doc.body || '',
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    published: !!doc.published,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

function normalizeTags(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((t) => String(t || '').trim().toLowerCase().slice(0, 24))
      .filter(Boolean)
      .slice(0, 8)
  }
  return String(raw || '')
    .split(/[,;\s]+/)
    .map((t) => t.trim().toLowerCase().slice(0, 24))
    .filter(Boolean)
    .slice(0, 8)
}

export default function createChangelogRoutes() {
  const router = Router()

  /** Published changelog — any logged-in user */
  router.get('/', authenticate, async (req, res) => {
    try {
      const list = await Changelog.find({ published: true }).sort({ createdAt: -1 }).limit(100).lean()
      res.json({ entries: list.map(publicEntry) })
    } catch (err) {
      logger.error({ err: err.message }, 'List changelog error')
      res.status(500).json({ error: 'Gagal memuat changelog' })
    }
  })

  /** Public for landing (no auth) — published only */
  router.get('/public', async (req, res) => {
    try {
      const list = await Changelog.find({ published: true }).sort({ createdAt: -1 }).limit(30).lean()
      res.json({
        entries: list.map((d) => ({
          entryId: d.entryId,
          version: d.version || '',
          title: d.title,
          body: d.body || '',
          tags: d.tags || [],
          createdAt: d.createdAt,
        })),
      })
    } catch (err) {
      logger.error({ err: err.message }, 'Public changelog error')
      res.status(500).json({ error: 'Gagal memuat changelog' })
    }
  })

  router.get('/admin/all', authenticate, requireAdmin, async (req, res) => {
    try {
      const list = await Changelog.find({}).sort({ createdAt: -1 }).limit(200).lean()
      res.json({ entries: list.map(publicEntry) })
    } catch (err) {
      logger.error({ err: err.message }, 'Admin changelog list error')
      res.status(500).json({ error: 'Gagal memuat changelog' })
    }
  })

  router.post('/admin', authenticate, requireAdmin, async (req, res) => {
    try {
      const title = String(req.body?.title || '').trim().slice(0, 160)
      const body = String(req.body?.body || '').trim().slice(0, 5000)
      const version = String(req.body?.version || '').trim().slice(0, 40)
      if (!title) return res.status(400).json({ error: 'Judul wajib' })
      const tags = normalizeTags(req.body?.tags)
      const entryId = `cl_${uuidv4().replace(/-/g, '').slice(0, 16)}`
      const doc = await Changelog.create({
        entryId,
        title,
        body,
        version,
        tags,
        published: req.body?.published !== false,
        createdBy: req.user.userId || 'admin',
      })
      res.status(201).json({ entry: publicEntry(doc) })
    } catch (err) {
      logger.error({ err: err.message }, 'Create changelog error')
      res.status(500).json({ error: 'Gagal membuat entry' })
    }
  })

  router.patch('/admin/:entryId', authenticate, requireAdmin, async (req, res) => {
    try {
      const entryId = String(req.params.entryId || '').trim()
      const update = {}
      if (req.body?.title !== undefined) update.title = String(req.body.title).trim().slice(0, 160)
      if (req.body?.body !== undefined) update.body = String(req.body.body).trim().slice(0, 5000)
      if (req.body?.version !== undefined) update.version = String(req.body.version).trim().slice(0, 40)
      if (req.body?.tags !== undefined) update.tags = normalizeTags(req.body.tags)
      if (req.body?.published !== undefined) update.published = Boolean(req.body.published)
      const doc = await Changelog.findOneAndUpdate({ entryId }, { $set: update }, { new: true })
      if (!doc) return res.status(404).json({ error: 'Tidak ditemukan' })
      res.json({ entry: publicEntry(doc) })
    } catch (err) {
      logger.error({ err: err.message }, 'Patch changelog error')
      res.status(500).json({ error: 'Gagal update' })
    }
  })

  router.delete('/admin/:entryId', authenticate, requireAdmin, async (req, res) => {
    try {
      const entryId = String(req.params.entryId || '').trim()
      const r = await Changelog.deleteOne({ entryId })
      if (!r.deletedCount) return res.status(404).json({ error: 'Tidak ditemukan' })
      res.json({ ok: true })
    } catch (err) {
      logger.error({ err: err.message }, 'Delete changelog error')
      res.status(500).json({ error: 'Gagal hapus' })
    }
  })

  return router
}
