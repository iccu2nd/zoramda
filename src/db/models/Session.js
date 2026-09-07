import mongoose from 'mongoose'

const sessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true },
    userId: { type: String, required: true, index: true },
    name: { type: String, default: '' },
    phoneNumber: { type: String, default: null },
    status: {
      type: String,
      enum: [
        'CREATING',
        'CONNECTING',
        'QR',
        'PAIRING',
        'CONNECTED',
        'RECONNECTING',
        'DISCONNECTED',
        'ERROR',
        'STOPPED',
      ],
      default: 'CREATING',
    },
    lastError: { type: String, default: null },
    qr: { type: String, default: null },
    pairingCode: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    collection: 'sessions',
  }
)

// compound only — avoid duplicate single-field indexes
sessionSchema.index({ userId: 1, isActive: 1 })

const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema)
export default Session
