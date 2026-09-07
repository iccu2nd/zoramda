import mongoose from 'mongoose'

const userSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    username: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, index: true },
    phone: { type: String, default: '' }, // personal WhatsApp number (not bot session)
    passwordHash: { type: String, required: true },
    apiKey: { type: String, required: true, unique: true, index: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    name: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    maxSessions: { type: Number, default: 5 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    collection: 'users',
  }
)

const User = mongoose.models.User || mongoose.model('User', userSchema)
export default User
