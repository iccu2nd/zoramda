import mongoose from 'mongoose'

const changelogSchema = new mongoose.Schema(
  {
    entryId: { type: String, required: true, unique: true, index: true },
    version: { type: String, default: '', maxlength: 40 },
    title: { type: String, required: true, maxlength: 160 },
    body: { type: String, default: '', maxlength: 5000 },
    /** optional tags e.g. new, fix, improve */
    tags: { type: [String], default: [] },
    published: { type: Boolean, default: true },
    createdBy: { type: String, default: 'admin' },
  },
  {
    timestamps: true,
    collection: 'changelogs',
  }
)

export default mongoose.models.Changelog || mongoose.model('Changelog', changelogSchema)
