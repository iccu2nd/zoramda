import mongoose from 'mongoose'

const paymentSchema = new mongoose.Schema(
  {
    trxId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    plan: { type: String, enum: ['pro', 'business'], required: true },
    amount: { type: Number, required: true },
    totalAmount: { type: Number, required: true },
    fee: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['pending', 'paid', 'expired', 'failed', 'unknown'],
      default: 'pending',
      index: true,
    },
    method: { type: String, default: 'qris' },
    orderId: { type: String, default: null },
    invId: { type: String, default: null, index: true },
    pendingUrl: { type: String, default: null },
    qrString: { type: String, default: null },
    paymentUrl: { type: String, default: null },
    paidAt: { type: Date, default: null },
    expiredAt: { type: Date, default: null },
    applied: { type: Boolean, default: false },
    raw: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    collection: 'payments',
  }
)

const Payment = mongoose.models.Payment || mongoose.model('Payment', paymentSchema)
export default Payment
