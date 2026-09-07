import mongoose from 'mongoose'

/**
 * Global bot settings – editable via API/web.
 * One document (key: "global") for simplicity; can extend per-session later.
 */
const botConfigSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'global', index: true },

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
