const mongoose = require('mongoose');

const reactionSchema = new mongoose.Schema(
  {
    thumbsUp: { type: Number, default: 0 },
    heart: { type: Number, default: 0 },
    laugh: { type: Number, default: 0 },
    surprise: { type: Number, default: 0 },
  },
  { _id: false },
);

const messageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    clientMessageId: { type: String, default: null },
    messageType: {
      type: String,
      enum: ['text', 'image', 'document', 'voice', 'payment', 'sticker'],
      default: 'text',
    },
    text: { type: String, default: '' },
    attachment: {
      fileName: String,
      storedName: String,
      mimeType: String,
      url: String,
      size: Number,
    },
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    reactions: { type: reactionSchema, default: () => ({}) },
    reactionUsers: [{
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      reaction: { type: String, enum: ['thumbsUp', 'heart', 'laugh', 'surprise'], required: true },
    }],
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    deliveryStatus: {
      type: String,
      enum: ['sent', 'delivered', 'read'],
      default: 'sent',
    },
  },
  { timestamps: true },
);

messageSchema.index({ conversation: 1, createdAt: -1 });
messageSchema.index(
  { conversation: 1, sender: 1, clientMessageId: 1 },
  { unique: true, partialFilterExpression: { clientMessageId: { $type: 'string' } } },
);

module.exports = mongoose.model('Message', messageSchema);
