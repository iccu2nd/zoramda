import mongoose from 'mongoose'

/**
 * Per-session bot settings.
 * One document per sessionId — Session A never shares state with Session B.
 */
/** Restriction flags. Empty list = public (siapa saja, chat mana saja). */
const PERMISSIONS = [
  'group',
  'private',
  'admin',
  'botadmin',
  'owner',
  'premium',
]

const sessionConfigSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },

    botName: { type: String, default: 'Botenv' },
    botNumber: { type: String, default: null },
    ownerNumbers: { type: [String], default: [] },
    ownerName: { type: String, default: 'Owner' },
    packName: { type: String, default: 'Botenv' },
    author: { type: String, default: '' },

    prefix: { type: String, default: '.' },
    publicMode: { type: Boolean, default: true },
    antiSpam: { type: Boolean, default: true },
    antiSpamCooldownMs: { type: Number, default: 2000 },
    readMessages: { type: Boolean, default: false },
    sendTyping: { type: Boolean, default: false },
    sendRecording: { type: Boolean, default: false },

    menuTitle: { type: String, default: 'Botenv Menu' },
    welcomeMessage: {
      type: String,
      default: 'Halo! Ketik {prefix}menu untuk melihat perintah.',
    },
    ownerOnlyMessage: { type: String, default: 'Perintah ini hanya untuk owner.' },
    adminOnlyMessage: { type: String, default: 'Perintah ini hanya untuk admin grup.' },
    groupOnlyMessage: { type: String, default: 'Perintah ini hanya bisa dipakai di dalam grup.' },
    privateOnlyMessage: {
      type: String,
      default: 'Perintah ini hanya bisa dipakai lewat chat pribadi.',
    },
    premiumOnlyMessage: { type: String, default: 'Perintah ini khusus untuk member premium.' },
    limitMessage: {
      type: String,
      default: 'Limit kamu sudah habis. Tunggu limit reset atau upgrade ke premium.',
    },
    maintenanceMode: { type: Boolean, default: false },
    maintenanceMessage: {
      type: String,
      default: 'Bot sedang maintenance. Coba lagi nanti.',
    },

    maxSessionsPerUser: { type: Number, default: 5 },
    bannedUsers: { type: [String], default: [] },
    premiumUsers: { type: [String], default: [] },
    pluginResponses: { type: mongoose.Schema.Types.Mixed, default: {} },

    /**
     * Custom auto-reply rules (tanpa prefix).
     * { trigger, reply, scope: 'all'|'group'|'private' }
     */
    autoReplies: {
      type: [
        {
          trigger: { type: String, default: '' },
          reply: { type: String, default: '' },
          scope: { type: String, enum: ['all', 'group', 'private'], default: 'all' },
        },
      ],
      default: [],
    },

    // Limit system — how many "uses" each WhatsApp user has for limited commands.
    useLimit: { type: Boolean, default: false },
    limitCost: { type: Number, default: 1 }, // how much limit is deducted per command use
    defaultLimit: { type: Number, default: 10 }, // starting limit for a new (non-premium) user
    premiumUnlimited: { type: Boolean, default: true }, // true = premium users bypass the limit entirely
    premiumDefaultLimit: { type: Number, default: 100 }, // used only when premiumUnlimited is false
    // Remaining limit balance per WhatsApp user, keyed by phone number digits only (no "@"/".")
    userLimits: { type: mongoose.Schema.Types.Mixed, default: {} },

    /**
     * Per-plugin state for this session.
     * Key = plugin relative file path (e.g. "main/ping.js") — keys contain "."
     * so this MUST be Mixed, not Map (Mongoose Map rejects dotted keys).
     * Value = { enabled: boolean, permissions: string[], commands?: string[] }
     * permissions is AND-combined: all selected must pass.
     */
    plugins: { type: mongoose.Schema.Types.Mixed, default: {} },

    extra: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    collection: 'session_configs',
  }
)

sessionConfigSchema.index({ userId: 1, sessionId: 1 })

const SessionConfig =
  mongoose.models.SessionConfig || mongoose.model('SessionConfig', sessionConfigSchema)

export default SessionConfig
export { PERMISSIONS }
