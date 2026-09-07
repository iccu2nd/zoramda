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

    botName: { type: String, default: 'Botenv' },
    botNumber: { type: String, default: null },
    ownerNumbers: { type: [String], default: [] },
    ownerName: { type: String, default: 'Owner' },

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
    maintenanceMode: { type: Boolean, default: false },
    maintenanceMessage: {
      type: String,
      default: 'Bot sedang maintenance. Coba lagi nanti.',
    },

    maxSessionsPerUser: { type: Number, default: 5 },
    bannedUsers: { type: [String], default: [] },
    pluginResponses: { type: mongoose.Schema.Types.Mixed, default: {} },

    /**
     * Per-plugin state for this session.
     * Key = plugin relative file path (e.g. "main/ping.js")
     * Value = { enabled: boolean, permissions: string[] }
     * permissions is AND-combined: all selected must pass.
     */
    plugins: {
      type: Map,
      of: new mongoose.Schema(
        {
          enabled: { type: Boolean, default: true },
          permissions: {
            type: [String],
            default: ['everyone'],
          },
          // Custom command aliases for this plugin in this session (empty = use plugin defaults)
          commands: { type: [String], default: undefined },
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
