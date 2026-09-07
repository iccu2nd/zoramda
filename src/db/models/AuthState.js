import mongoose from 'mongoose'

const authStateSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    // creds stored as BufferJSON compatible object
    creds: { type: mongoose.Schema.Types.Mixed, default: null },
    // keys: Map-like structure { category: { id: data } }
    keys: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    collection: 'auth_states',
  }
)

const AuthState = mongoose.models.AuthState || mongoose.model('AuthState', authStateSchema)
export default AuthState
