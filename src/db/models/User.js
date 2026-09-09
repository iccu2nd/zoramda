import mongoose from 'mongoose'

/**
 * plan = free | pro | business  (subscription / paid tier)
 * role = user | admin            (staff elevation; admin bypasses plan limits)
 */
const userSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    username: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, index: true },
    phone: { type: String, default: '' },
    passwordHash: { type: String, required: true },
    apiKey: { type: String, required: true, unique: true, index: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    plan: { type: String, enum: ['free', 'pro', 'business'], default: 'free', index: true },
    planExpiresAt: { type: Date, default: null },
    name: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    emailVerified: { type: Boolean, default: false },
    emailVerificationToken: { type: String, default: null, index: true },
    emailVerificationExpires: { type: Date, default: null },
    emailVerificationSentAt: { type: Date, default: null },
    maxSessions: { type: Number, default: 1 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    collection: 'users',
  }
)

const User = mongoose.models.User || mongoose.model('User', userSchema)
export default User
