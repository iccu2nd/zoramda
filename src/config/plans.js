/**
 * Subscription plans — single source of truth.
 * feature flags make future Business-only features easy to add.
 */
export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    amount: 0,
    maxSessions: 1,
    durationDays: null,
    features: {
      pairing: true,
      botSettings: false,
    },
    featureList: [
      'Connect Pairing',
      '1 session WhatsApp',
      'Bot Settings terkunci',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    amount: 5000,
    maxSessions: 5,
    durationDays: 30,
    features: {
      pairing: true,
      botSettings: true,
    },
    featureList: [
      'Connect Pairing',
      'Bot Settings (config, message, system, plugins)',
      '5 session WhatsApp',
    ],
  },
  business: {
    id: 'business',
    name: 'Business',
    amount: 15000,
    maxSessions: 15,
    durationDays: 30,
    features: {
      pairing: true,
      botSettings: true,
      // room for: apiAccess, prioritySupport, etc.
    },
    featureList: [
      'Semua fitur Pro',
      '15 session WhatsApp',
      'Siap fitur Business berikutnya',
    ],
  },
}

/** QRIS validity window (ms) — fixed at create time on backend */
export const QRIS_TTL_MS = 60 * 60 * 1000 // 1 hour

export function getPlan(id) {
  return PLANS[String(id || '').toLowerCase()] || null
}

export function resolveEffectivePlan(user) {
  if (!user) return PLANS.free
  if (user.role === 'admin') {
    return {
      ...PLANS.business,
      id: 'business',
      name: 'Admin',
      features: { pairing: true, botSettings: true },
    }
  }
  const plan = getPlan(user.plan) || PLANS.free
  if (
    plan.id !== 'free' &&
    user.planExpiresAt &&
    new Date(user.planExpiresAt).getTime() < Date.now()
  ) {
    return PLANS.free
  }
  return plan
}

export function hasFeature(user, featureKey) {
  const plan = resolveEffectivePlan(user)
  return !!plan.features?.[featureKey]
}

export function publicPlans() {
  return Object.values(PLANS).map((p) => ({
    id: p.id,
    name: p.name,
    amount: p.amount,
    maxSessions: p.maxSessions,
    durationDays: p.durationDays,
    features: p.features,
    featureList: p.featureList,
  }))
}

export default PLANS
