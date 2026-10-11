const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['individual', 'group'],
      required: true,
    },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
    name: { type: String, default: '' },
    image: { type: String, default: '' },
    lastMessage: { type: String, default: '' },
    lastMessageAt: { type: Date, default: Date.now },
    metadata: {
      admins: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      mutedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      pinnedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    },
  },
  { timestamps: true },
);

conversationSchema.index({ members: 1, type: 1 });

module.exports = mongoose.model('Conversation', conversationSchema);
