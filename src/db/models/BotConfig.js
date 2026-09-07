import mongoose from 'mongoose'

/**
 * Per-user bot settings – editable via API/web, no admin key needed.
 * One document per userId.
 */
const botConfigSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },

    // Identity
    botName: { type: String, default: 'ZoraBot' },
    botNumber: { type: String, default: null }, // optional display
    ownerNumbers: { type: [String], default: [] },
    ownerName: { type: String, default: 'Owner' },

    // Behavior
    prefix: { type: String, default: '.' },
    publicMode: { type: Boolean, default: true }, // false = only owner can use
    antiSpam: { type: Boolean, default: true },
    antiSpamCooldownMs: { type: Number, default: 2000 },

    // Messages
    menuTitle: { type: String, default: 'ZoraBot Menu' },
    welcomeMessage: { type: String, default: 'Halo! Ketik {prefix}menu untuk melihat perintah.' },
    ownerOnlyMessage: { type: String, default: 'Perintah ini hanya untuk owner.' },
    maintenanceMode: { type: Boolean, default: false },
    maintenanceMessage: { type: String, default: 'Bot sedang maintenance. Coba lagi nanti.' },

    // Limits
    maxSessionsPerUser: { type: Number, default: 5 },

    // Users (by normalized JID, e.g. 6281234567890@s.whatsapp.net) blocked
    // from using any bot command for this session's owner.
    bannedUsers: { type: [String], default: [] },

    // Per-plugin response overrides: { [command]: { [responseKey]: text } }
    pluginResponses: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Extra free-form settings (plugins can store custom keys here)
    extra: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    collection: 'bot_configs',
  }
)

const BotConfig = mongoose.models.BotConfig || mongoose.model('BotConfig', botConfigSchema)
export default BotConfig
