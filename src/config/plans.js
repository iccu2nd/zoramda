/**
 * Subscription plans — single source of truth for pricing & limits.
 * Amounts in IDR. Only QRIS is offered at checkout.
 */
export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    amount: 0,
    maxSessions: 1,
    durationDays: null,
    features: ['1 session WhatsApp', 'Plugin dasar', 'Dashboard config'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    amount: 49000,
    maxSessions: 5,
    durationDays: 30,
    features: [
      '5 session WhatsApp',
      'Semua plugin',
      'Limit & premium user',
      'Support chat',
    ],
  },
  business: {
    id: 'business',
    name: 'Business',
    amount: 149000,
    maxSessions: 15,
    durationDays: 30,
    features: [
      '15 session WhatsApp',
      'API access penuh',
      'Admin panel tools',
      'Priority support',
    ],
  },
}

export function getPlan(id) {
  return PLANS[String(id || '').toLowerCase()] || null
}

export function publicPlans() {
  return Object.values(PLANS).map((p) => ({
    id: p.id,
    name: p.name,
    amount: p.amount,
    maxSessions: p.maxSessions,
    durationDays: p.durationDays,
    features: p.features,
  }))
}

export default PLANS
