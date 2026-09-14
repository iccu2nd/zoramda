import mongoose from 'mongoose'

/**
 * Fitur gratis yang dibagikan admin.
 * User bisa "Apply" ke session bot mereka.
 *
 * kind:
 *  - autoreply → data = [{ trigger, reply, scope }]
 *  - plugins   → data = [{ file, enabled?, permissions? }]
 */
const sharedFeatureSchema = new mongoose.Schema(
  {
    featureId: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 500 },
    kind: { type: String, enum: ['autoreply', 'plugins'], required: true },
    data: { type: mongoose.Schema.Types.Mixed, default: [] },
    active: { type: Boolean, default: true },
    createdBy: { type: String, default: 'admin' },
  },
  {
    timestamps: true,
    collection: 'shared_features',
  }
)

export default mongoose.models.SharedFeature || mongoose.model('SharedFeature', sharedFeatureSchema)
