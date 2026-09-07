import mongoose from 'mongoose'

/**
 * Per-session bot settings.
 * One document per sessionId — Session A never shares state with Session B.
 */
const PERMISSIONS = [
  'everyone',
  'group',
  'private',
  'admin',
  'botadmin',
  'owner',
]

const sessionConfigSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },

    // Identity
    botName: { type: String, default: 'ZoraBot' },
    botNumber: { type: String, default: null },
    ownerNumbers: { type: [String], default: [] },
    ownerName: { type: String, default: 'Owner' },

    // Behavior
    prefix: { type: String, default: '.' },
    publicMode: { type: Boolean, default: true },
    antiSpam: { type: Boolean, default: true },
    antiSpamCooldownMs: { type: Number, default: 2000 },
    readMessages: { type: Boolean, default: false },
    sendTyping: { type: Boolean, default: false },
    sendRecording: { type: Boolean, default: false },

    // Messages
    menuTitle: { type: String, default: 'ZoraBot Menu' },
    welcomeMessage: {
      type: String,
      default: 'Halo! Ketik {prefix}menu untuk melihat perintah.',
    },
    ownerOnlyMessage: { type: String, default: 'Perintah ini hanya untuk owner.' },
    maintenanceMode: { type: Boolean, default: false },
    maintenanceMessage: {
      type: String,
      default: 'Bot sedang maintenance. Coba lagi nanti.',
    },

    // Limits (kept for compatibility; real limit is still env-level)
    maxSessionsPerUser: { type: Number, default: 5 },

    // Banned JIDs for this session only
    bannedUsers: { type: [String], default: [] },

    // Per-plugin response overrides: { [command]: { [key]: text } }
    pluginResponses: { type: mongoose.Schema.Types.Mixed, default: {} },

    /**
     * Per-plugin state for this session.
     * Key = plugin relative file path (e.g. "main/ping.js")
     * Value = { enabled: boolean, permission: string }
     */
    plugins: {
      type: Map,
      of: new mongoose.Schema(
        {
          enabled: { type: Boolean, default: true },
          permission: {
            type: String,
            enum: PERMISSIONS,
            default: 'everyone',
          },
        },
        { _id: false }
      ),
      default: {},
    },

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
