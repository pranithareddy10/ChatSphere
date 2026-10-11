const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true, min: 0.01, max: 1000000 },
    currency: { type: String, enum: ['USD'], default: 'USD' },
    paymentNote: { type: String, default: '', maxlength: 200 },
    providerReference: { type: String, default: '' },
    paymentMode: { type: String, enum: ['demo'], default: 'demo' },
    status: {
      type: String,
      enum: ['pending', 'success', 'failed'],
      default: 'pending',
    },
  },
  { timestamps: true },
);

transactionSchema.index({ sender: 1, createdAt: -1 });
transactionSchema.index({ providerReference: 1 }, {
  unique: true,
  partialFilterExpression: { providerReference: { $gt: '' } },
});

module.exports = mongoose.model('Transaction', transactionSchema);
