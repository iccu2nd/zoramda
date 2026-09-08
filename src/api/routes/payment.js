import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { authenticate } from '../middleware/auth.js'
import User from '../../db/models/User.js'
import Payment from '../../db/models/Payment.js'
import { publicPlans, getPlan } from '../../config/plans.js'
import { createQrisPayment, checkPaymentStatus } from '../../services/sociabuzz.js'
import logger from '../../utils/logger.js'

const router = Router()

function publicPayment(doc) {
  if (!doc) return null
  return {
    trxId: doc.trxId,
    plan: doc.plan,
    amount: doc.amount,
    totalAmount: doc.totalAmount,
    fee: doc.fee,
    status: doc.status,
    method: doc.method,
    qrString: doc.qrString || null,
    invId: doc.invId || null,
    expiredAt: doc.expiredAt || null,
    paidAt: doc.paidAt || null,
    createdAt: doc.createdAt,
  }
}

async function applyPlanToUser(userId, planId) {
  const plan = getPlan(planId)
  if (!plan || planId === 'free') return null

  const expires = plan.durationDays
    ? new Date(Date.now() + plan.durationDays * 24 * 60 * 60 * 1000)
    : null

  const user = await User.findOneAndUpdate(
    { userId },
    {
      $set: {
        plan: plan.id,
        planExpiresAt: expires,
        maxSessions: plan.maxSessions,
      },
    },
    { new: true }
  )
  return user
}

/** GET /api/payment/plans */
router.get('/plans', authenticate, (req, res) => {
  res.json({ plans: publicPlans() })
})

/** GET /api/payment/me — current plan summary */
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.user.userId }).lean()
    if (!user) return res.status(404).json({ error: 'User not found' })
    const plan = getPlan(user.plan) || getPlan('free')
    res.json({
      plan: user.plan || 'free',
      planExpiresAt: user.planExpiresAt || null,
      maxSessions: user.maxSessions ?? plan.maxSessions,
      role: user.role,
    })
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat paket' })
  }
})

/**
 * POST /api/payment/checkout
 * Body: { plan: 'pro' | 'business' }
 * Creates Sociabuzz QRIS transaction (server-side only).
 */
router.post('/checkout', authenticate, async (req, res) => {
  try {
    const planId = String(req.body?.plan || '').toLowerCase()
    const plan = getPlan(planId)
    if (!plan || plan.amount <= 0) {
      return res.status(400).json({ error: 'Paket tidak valid. Pilih Pro atau Business.' })
    }

    // Block if already on same or higher paid plan that is not expired
    const user = await User.findOne({ userId: req.user.userId })
    if (!user) return res.status(404).json({ error: 'User not found' })

    if (user.role === 'admin') {
      return res.status(400).json({ error: 'Akun admin tidak perlu upgrade paket.' })
    }

    // Cancel previous pending txs for this user (soft)
    await Payment.updateMany(
      { userId: user.userId, status: 'pending' },
      { $set: { status: 'expired' } }
    )

    let gateway
    try {
      gateway = await createQrisPayment(plan.amount, {
        name: user.name || user.username,
        email: user.email,
        message: `Upgrade ${plan.name} — ${user.username}`,
      })
    } catch (err) {
      logger.error({ err: err.message, userId: user.userId }, 'Checkout Sociabuzz failed')
      return res.status(502).json({
        error: err.message || 'Gagal membuat pembayaran QRIS. Coba lagi nanti.',
      })
    }

    const trxId = `TRX-${Date.now()}${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`

    const payment = await Payment.create({
      trxId,
      userId: user.userId,
      plan: plan.id,
      amount: plan.amount,
      totalAmount: gateway.totalAmount,
      fee: gateway.fee,
      status: 'pending',
      method: 'qris',
      orderId: gateway.orderId,
      invId: gateway.invId,
      pendingUrl: gateway.pendingUrl,
      qrString: gateway.qrString,
      paymentUrl: gateway.paymentUrl,
      expiredAt: gateway.expiredAt,
      raw: gateway.raw,
    })

    res.status(201).json({ payment: publicPayment(payment) })
  } catch (err) {
    logger.error({ err: err.message }, 'Checkout error')
    res.status(500).json({ error: 'Checkout gagal' })
  }
})

/**
 * GET /api/payment/:trxId
 */
router.get('/:trxId', authenticate, async (req, res) => {
  try {
    const payment = await Payment.findOne({
      trxId: req.params.trxId,
      userId: req.user.userId,
    }).lean()
    if (!payment) return res.status(404).json({ error: 'Transaksi tidak ditemukan' })
    res.json({ payment: publicPayment(payment) })
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat transaksi' })
  }
})

/**
 * POST /api/payment/:trxId/check
 * Manual status check only — no background polling.
 * On success, applies plan to user exactly once.
 */
router.post('/:trxId/check', authenticate, async (req, res) => {
  try {
    const payment = await Payment.findOne({
      trxId: req.params.trxId,
      userId: req.user.userId,
    })
    if (!payment) return res.status(404).json({ error: 'Transaksi tidak ditemukan' })

    // Already applied
    if (payment.status === 'paid' && payment.applied) {
      return res.json({
        payment: publicPayment(payment),
        message: 'Pembayaran sudah berhasil. Paket aktif.',
      })
    }

    // Local expiry
    if (
      payment.status === 'pending' &&
      payment.expiredAt &&
      new Date(payment.expiredAt).getTime() < Date.now()
    ) {
      payment.status = 'expired'
      await payment.save()
      return res.json({
        payment: publicPayment(payment),
        message: 'Transaksi sudah kedaluwarsa. Buat pembayaran baru.',
      })
    }

    if (['expired', 'failed'].includes(payment.status)) {
      return res.json({
        payment: publicPayment(payment),
        message:
          payment.status === 'expired'
            ? 'Transaksi kedaluwarsa.'
            : 'Pembayaran gagal.',
      })
    }

    if (!payment.pendingUrl) {
      return res.status(400).json({ error: 'URL status tidak tersedia untuk transaksi ini' })
    }

    let result
    try {
      result = await checkPaymentStatus(payment.pendingUrl)
    } catch (err) {
      return res.status(502).json({ error: err.message || 'Gagal cek status' })
    }

    const mapped =
      result.status === 'paid'
        ? 'paid'
        : result.status === 'expired'
          ? 'expired'
          : result.status === 'failed'
            ? 'failed'
            : result.status === 'pending'
              ? 'pending'
              : payment.status

    payment.status = mapped

    if (mapped === 'paid' && !payment.applied) {
      payment.paidAt = new Date()
      // Apply plan only after gateway confirms success
      const user = await applyPlanToUser(payment.userId, payment.plan)
      if (user) {
        payment.applied = true
        logger.info(
          { userId: payment.userId, plan: payment.plan, trxId: payment.trxId },
          'Plan applied after payment'
        )
      }
    }

    await payment.save()

    const messages = {
      pending: 'Menunggu pembayaran. Scan QRIS lalu cek status lagi.',
      paid: 'Pembayaran berhasil. Paket sudah diaktifkan.',
      expired: 'Transaksi kedaluwarsa. Buat pembayaran baru.',
      failed: 'Pembayaran gagal atau tidak ditemukan.',
      unknown: 'Status belum jelas. Coba cek lagi sebentar.',
    }

    res.json({
      payment: publicPayment(payment),
      message: messages[payment.status] || messages.unknown,
    })
  } catch (err) {
    logger.error({ err: err.message }, 'Payment check error')
    res.status(500).json({ error: 'Gagal mengecek pembayaran' })
  }
})

/** Recent payments for current user */
router.get('/', authenticate, async (req, res) => {
  try {
    const list = await Payment.find({ userId: req.user.userId })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean()
    res.json({ payments: list.map(publicPayment) })
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat riwayat' })
  }
})

export default router
