import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import SharedFeature from '../../db/models/SharedFeature.js'
import Session from '../../db/models/Session.js'
import configService from '../../core/ConfigService.js'
import logger from '../../utils/logger.js'
import { resolveEffectivePlan } from '../../config/plans.js'

const PLAN_IDS = ['free', 'pro', 'business']

function normalizePlans(raw) {
  const set = new Set()
  const arr = Array.isArray(raw) ? raw : String(raw || '').split(/[,;\s]+/)
  for (const p of arr) {
    const id = String(p || '').toLowerCase().trim()
    if (PLAN_IDS.includes(id)) set.add(id)
  }
  if (!set.size) return [...PLAN_IDS]
  return PLAN_IDS.filter((id) => set.has(id))
}

function normalizePlugins(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  const seen = new Set()
  for (const item of raw) {
    let file = ''
    let enabled = true
    let permissions = []
    if (typeof item === 'string') {
      file = item.trim()
    } else if (item && typeof item === 'object') {
      file = String(item.file || '').trim()
      enabled = item.enabled !== false
      permissions = Array.isArray(item.permissions) ? item.permissions.map(String) : []
    }
    if (!file || seen.has(file)) continue
    seen.add(file)
    out.push({ file, enabled, permissions })
    if (out.length >= 80) break
  }
  return out
}

function resolvePlugins(doc) {
  if (Array.isArray(doc.plugins) && doc.plugins.length) return normalizePlugins(doc.plugins)
  if (Array.isArray(doc.data) && doc.data.length) return normalizePlugins(doc.data)
  return []
}

/** User-facing — tanpa source / tanpa daftar file detail berlebih */
function publicFeature(doc, { admin = false } = {}) {
  const plugins = resolvePlugins(doc)
  const base = {
    featureId: doc.featureId,
    title: doc.title,
    description: doc.description || '',
    kind: 'plugins',
    plans: normalizePlans(doc.plans),
    pluginCount: plugins.length,
    active: !!doc.active,
    createdAt: doc.createdAt,
  }
  if (admin) {
    base.plugins = plugins
  }
  return base
}

function userPlanId(req) {
  if (req.user?.isAdmin) return 'business'
  const effective = resolveEffectivePlan({
    role: req.user?.role,
    plan: req.user?.plan,
    planExpiresAt: req.user?.planExpiresAt,
  })
  return effective?.id || 'free'
}

export default function createSharedFeatureRoutes(sessionManager) {
  const router = Router()

  /** List fitur aktif yang cocok dengan paket user (tanpa kode plugin) */
  router.get('/', authenticate, async (req, res) => {
    try {
      const plan = userPlanId(req)
      const list = await SharedFeature.find({ active: true }).sort({ createdAt: -1 }).lean()
      const features = list
        .filter((doc) => normalizePlans(doc.plans).includes(plan))
        .map((doc) => publicFeature(doc, { admin: false }))
      res.json({ features, plan })
    } catch (err) {
      logger.error({ err: err.message }, 'List shared features error')
      res.status(500).json({ error: 'Gagal memuat fitur' })
    }
  })

  /** Apply plugin ke session — enable file di server, user tidak perlu source */
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

      const plan = userPlanId(req)
      if (!normalizePlans(feature.plans).includes(plan)) {
        return res.status(403).json({ error: 'Fitur ini tidak tersedia untuk paket kamu' })
      }

      const items = resolvePlugins(feature)
      if (!items.length) return res.status(400).json({ error: 'Fitur tidak punya plugin' })

      // Optional: pastikan file ada di loader
      const loader = sessionManager?.pluginLoader
      if (loader?.getAllPlugins) {
        const known = new Set(loader.getAllPlugins().map((p) => p.file))
        const missing = items.filter((it) => !known.has(it.file))
        if (missing.length === items.length) {
          return res.status(400).json({ error: 'Plugin fitur tidak tersedia di server' })
        }
      }

      await configService.getConfig(sessionId, req.user.userId)
      const states = {}
      for (const it of items) {
        states[it.file] = {
          enabled: it.enabled !== false,
          permissions: it.permissions || [],
        }
      }
      await configService.updatePluginStates(sessionId, req.user.userId, states)
      res.json({ ok: true, kind: 'plugins', applied: Object.keys(states).length })
    } catch (err) {
      logger.error({ err: err.message }, 'Apply shared feature error')
      res.status(500).json({ error: err.message || 'Gagal apply fitur' })
    }
  })

  /** Admin list */
  router.get('/admin/all', authenticate, requireAdmin, async (req, res) => {
    try {
      const list = await SharedFeature.find({}).sort({ createdAt: -1 }).lean()
      res.json({ features: list.map((d) => publicFeature(d, { admin: true })) })
    } catch (err) {
      logger.error({ err: err.message }, 'Admin list shared features error')
      res.status(500).json({ error: 'Gagal memuat fitur' })
    }
  })

  /** Admin create — pilih plugin file + paket */
  router.post('/admin', authenticate, requireAdmin, async (req, res) => {
    try {
      const title = String(req.body?.title || '').trim().slice(0, 120)
      const description = String(req.body?.description || '').trim().slice(0, 500)
      if (!title) return res.status(400).json({ error: 'Judul wajib' })

      let plugins = req.body?.plugins ?? req.body?.data
      if (typeof plugins === 'string') {
        try {
          plugins = JSON.parse(plugins)
        } catch {
          return res.status(400).json({ error: 'Data plugin tidak valid' })
        }
      }
      plugins = normalizePlugins(plugins)
      if (!plugins.length) return res.status(400).json({ error: 'Pilih minimal 1 plugin' })

      const plans = normalizePlans(req.body?.plans)

      const featureId = `sf_${uuidv4().replace(/-/g, '').slice(0, 16)}`
      const doc = await SharedFeature.create({
        featureId,
        title,
        description,
        kind: 'plugins',
        plugins,
        data: plugins,
        plans,
        active: true,
        createdBy: req.user.userId || 'admin',
      })
      res.status(201).json({ feature: publicFeature(doc, { admin: true }) })
    } catch (err) {
      logger.error({ err: err.message }, 'Create shared feature error')
      res.status(500).json({ error: 'Gagal membuat fitur' })
    }
  })

  router.patch('/admin/:featureId', authenticate, requireAdmin, async (req, res) => {
    try {
      const featureId = String(req.params.featureId || '').trim()
      const update = {}
      if (req.body?.title !== undefined) update.title = String(req.body.title).trim().slice(0, 120)
      if (req.body?.description !== undefined)
        update.description = String(req.body.description).trim().slice(0, 500)
      if (req.body?.active !== undefined) update.active = Boolean(req.body.active)
      if (req.body?.plans !== undefined) update.plans = normalizePlans(req.body.plans)
      if (req.body?.plugins !== undefined || req.body?.data !== undefined) {
        let plugins = req.body.plugins ?? req.body.data
        if (typeof plugins === 'string') plugins = JSON.parse(plugins)
        plugins = normalizePlugins(plugins)
        update.plugins = plugins
        update.data = plugins
        update.kind = 'plugins'
      }
      const doc = await SharedFeature.findOneAndUpdate({ featureId }, { $set: update }, { new: true })
      if (!doc) return res.status(404).json({ error: 'Tidak ditemukan' })
      res.json({ feature: publicFeature(doc, { admin: true }) })
    } catch (err) {
      logger.error({ err: err.message }, 'Patch shared feature error')
      res.status(500).json({ error: 'Gagal update fitur' })
    }
  })

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
