import mongoose from 'mongoose'

/**
 * Fitur (plugin) yang dibagikan admin.
 * User apply ke session — kode plugin tetap di server, user tidak melihat source.
 * plans: paket yang boleh melihat & apply (free | pro | business)
 */
const sharedFeatureSchema = new mongoose.Schema(
  {
    featureId: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 500 },
    /** Always plugins for shared free features */
    kind: { type: String, enum: ['plugins'], default: 'plugins' },
    /**
     * Plugin files di disk (relative path), e.g. "main/ping.js"
     * Source tidak pernah dikirim ke client user.
     */
    plugins: {
      type: [
        {
          file: { type: String, required: true },
          enabled: { type: Boolean, default: true },
          permissions: { type: [String], default: [] },
        },
      ],
      default: [],
    },
    /** Legacy field — diabaikan jika plugins terisi */
    data: { type: mongoose.Schema.Types.Mixed, default: [] },
    /** Paket yang boleh pakai fitur ini */
    plans: {
      type: [String],
      default: ['free', 'pro', 'business'],
      validate: {
        validator(arr) {
          if (!Array.isArray(arr) || !arr.length) return false
          const ok = new Set(['free', 'pro', 'business'])
          return arr.every((p) => ok.has(String(p).toLowerCase()))
        },
        message: 'plans harus free/pro/business',
      },
    },
    active: { type: Boolean, default: true },
    createdBy: { type: String, default: 'admin' },
  },
  {
    timestamps: true,
    collection: 'shared_features',
  }
)

export default mongoose.models.SharedFeature || mongoose.model('SharedFeature', sharedFeatureSchema)
