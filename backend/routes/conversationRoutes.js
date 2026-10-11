const express = require('express');
const mongoose = require('mongoose');
const fs = require('node:fs');
const path = require('node:path');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const allowedReactions = new Set(['thumbsUp', 'heart', 'laugh', 'surprise']);

async function ensureConversationAccess(userId, conversationId) {
  if (!mongoose.isValidObjectId(conversationId)) {
    const error = new Error('Conversation not found.');
    error.statusCode = 404;
    throw error;
  }

  const conversation = await Conversation.findById(conversationId).populate('members', 'name email avatar status');
  if (!conversation) {
    const error = new Error('Conversation not found.');
    error.statusCode = 404;
    throw error;
  }

  if (!conversation.members.some((member) => member._id.toString() === userId.toString())) {
    const error = new Error('You are not authorized to access this conversation.');
    error.statusCode = 403;
    throw error;
  }

  return conversation;
}

function emitConversationEvent(conversation, event, payload) {
  const io = global.__io;
  if (!io) return;
  io.to(conversation._id.toString()).emit(event, payload);
  const userEvent = event === 'new-message' ? 'conversation-message' : event;
  conversation.members.forEach((member) => {
    const memberId = member._id || member;
    io.to(`user:${memberId.toString()}`).emit(userEvent, payload);
  });
}

router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const conversations = await Conversation.find({ members: req.user._id })
      .populate('members', 'name email avatar status')
      .sort({ lastMessageAt: -1, updatedAt: -1 });
    const unreadCounts = await Message.aggregate([
      {
        $match: {
          conversation: { $in: conversations.map((conversation) => conversation._id) },
          sender: { $ne: req.user._id },
          readBy: { $ne: req.user._id },
        },
      },
      { $group: { _id: '$conversation', count: { $sum: 1 } } },
    ]);
    const unreadByConversation = new Map(unreadCounts.map((entry) => [entry._id.toString(), entry.count]));
    const result = conversations.map((conversation) => ({
      ...conversation.toObject(),
      unreadCount: unreadByConversation.get(conversation._id.toString()) || 0,
    }));
    return res.json({ conversations: result });
  } catch (error) {
    next(error);
  }
});

router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const { participantId, type = 'individual', name = '' } = req.body || {};

    if (type === 'individual') {
      if (!participantId || !mongoose.isValidObjectId(participantId)) {
        return res.status(400).json({ message: 'A valid participant is required.' });
      }
      if (participantId === req.user._id.toString()) {
        return res.status(400).json({ message: 'You cannot start a conversation with yourself.' });
      }

      const participant = await User.findById(participantId);
      if (!participant) return res.status(404).json({ message: 'Participant not found.' });

      let conversation = await Conversation.findOne({
        type: 'individual',
        members: { $all: [req.user._id, participantId], $size: 2 },
      }).populate('members', 'name email avatar status');

      if (!conversation) {
        conversation = await Conversation.create({
          type: 'individual',
          members: [req.user._id, participantId],
          name: participant.name,
        });
        await conversation.populate('members', 'name email avatar status');
        if (global.__io) global.__io.to(`user:${participantId}`).emit('conversation-added', { conversation });
      }
      return res.status(200).json({ conversation });
    }

    if (type !== 'group') return res.status(400).json({ message: 'Unsupported conversation type.' });
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ message: 'Group conversations require a name.' });

    const suppliedMembers = Array.isArray(req.body.members) ? req.body.members : [];
    const memberIds = [...new Set([req.user._id.toString(), ...suppliedMembers.map(String)])];
    if (memberIds.some((id) => !mongoose.isValidObjectId(id))) {
      return res.status(400).json({ message: 'All group members must have valid user identifiers.' });
    }
    const existingUsers = await User.countDocuments({ _id: { $in: memberIds } });
    if (existingUsers !== memberIds.length) return res.status(400).json({ message: 'One or more group members do not exist.' });

    const conversation = await Conversation.create({
      type: 'group',
      name: name.trim(),
      members: memberIds,
      metadata: { admins: [req.user._id] },
    });
    await conversation.populate('members', 'name email avatar status');
    if (global.__io) {
      conversation.members.forEach((member) => global.__io.to(`user:${member._id.toString()}`).emit('conversation-added', { conversation }));
    }
    return res.status(201).json({ conversation });
  } catch (error) {
    next(error);
  }
});

router.get('/:conversationId/messages', authMiddleware, async (req, res, next) => {
  try {
    const conversation = await ensureConversationAccess(req.user._id, req.params.conversationId);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const query = { conversation: conversation._id };
    if (req.query.search !== undefined) {
      if (typeof req.query.search !== 'string' || req.query.search.trim().length > 100) {
        return res.status(400).json({ message: 'Message search must be 100 characters or fewer.' });
      }
      const search = req.query.search.trim();
      if (search) {
        const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        query.$or = [
          { text: { $regex: escapedSearch, $options: 'i' } },
          { 'attachment.fileName': { $regex: escapedSearch, $options: 'i' } },
        ];
      }
    }
    if (req.query.before && !Number.isNaN(Date.parse(req.query.before))) {
      query.createdAt = { $lt: new Date(req.query.before) };
    }

    const messages = await Message.find(query)
      .populate('sender', 'name avatar')
      .populate({ path: 'replyTo', populate: { path: 'sender', select: 'name avatar' } })
      .populate('readBy', 'name avatar')
      .sort({ createdAt: -1 })
      .limit(limit);

    return res.json({ conversation, messages: messages.reverse() });
  } catch (error) {
    next(error);
  }
});

router.post('/:conversationId/messages', authMiddleware, async (req, res, next) => {
  try {
    const conversation = await ensureConversationAccess(req.user._id, req.params.conversationId);
    const { text = '', messageType = 'text', replyTo = null, attachment = null, clientMessageId = null } = req.body || {};

    if (!['text', 'sticker'].includes(messageType)) {
      return res.status(400).json({ message: 'Unsupported message type.' });
    }
    if (attachment) return res.status(400).json({ message: 'Upload attachments through the authenticated upload endpoint.' });
    if (typeof text !== 'string' || !text.trim() || text.length > 5000) {
      return res.status(400).json({ message: 'Message text is required and must be 5,000 characters or fewer.' });
    }
    if (clientMessageId !== null && (typeof clientMessageId !== 'string' || clientMessageId.length > 100)) {
      return res.status(400).json({ message: 'Invalid client message identifier.' });
    }

    if (clientMessageId) {
      const existingMessage = await Message.findOne({
        conversation: conversation._id,
        sender: req.user._id,
        clientMessageId,
      }).populate('sender', 'name avatar');
      if (existingMessage) return res.status(200).json({ message: existingMessage, duplicate: true });
    }

    if (replyTo) {
      if (!mongoose.isValidObjectId(replyTo)) {
        return res.status(400).json({ message: 'Invalid replied-to message identifier.' });
      }
      const replyTarget = await Message.findOne({ _id: replyTo, conversation: conversation._id });
      if (!replyTarget) return res.status(400).json({ message: 'The replied-to message does not exist in this conversation.' });
    }

    const message = await Message.create({
      conversation: conversation._id,
      sender: req.user._id,
      clientMessageId,
      messageType,
      text: text.trim(),
      attachment,
      replyTo,
      readBy: [req.user._id],
    });

    conversation.lastMessage = text.trim() || attachment?.fileName || 'Attachment';
    conversation.lastMessageAt = message.createdAt;
    await conversation.save();

    const populatedMessage = await Message.findById(message._id)
      .populate('sender', 'name avatar')
      .populate({ path: 'replyTo', populate: { path: 'sender', select: 'name avatar' } })
      .populate('readBy', 'name avatar');
    emitConversationEvent(conversation, 'new-message', { conversationId: conversation._id.toString(), message: populatedMessage });

    return res.status(201).json({ message: populatedMessage });
  } catch (error) {
    if (error.code === 11000 && req.body?.clientMessageId) {
      try {
        const duplicate = await Message.findOne({
          conversation: req.params.conversationId,
          sender: req.user._id,
          clientMessageId: req.body.clientMessageId,
        }).populate('sender', 'name avatar');
        if (duplicate) return res.status(200).json({ message: duplicate, duplicate: true });
      } catch (lookupError) {
        return next(lookupError);
      }
    }
    next(error);
  }
});

router.patch('/:conversationId/messages/:messageId', authMiddleware, async (req, res, next) => {
  try {
    const conversation = await ensureConversationAccess(req.user._id, req.params.conversationId);
    if (!mongoose.isValidObjectId(req.params.messageId)) return res.status(404).json({ message: 'Message not found.' });
    const message = await Message.findOne({ _id: req.params.messageId, conversation: conversation._id });
    if (!message) return res.status(404).json({ message: 'Message not found.' });
    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You can only edit your own messages.' });
    }

    const { text } = req.body || {};
    if (typeof text !== 'string' || !text.trim() || text.length > 5000) {
      return res.status(400).json({ message: 'Message text is required and must be 5,000 characters or fewer.' });
    }
    message.text = text.trim();
    await message.save();
    if (conversation.lastMessageAt?.getTime() === message.createdAt.getTime()) {
      conversation.lastMessage = message.text;
      await conversation.save();
    }
    const populatedMessage = await Message.findById(message._id).populate('sender', 'name avatar');
    emitConversationEvent(conversation, 'message-updated', { conversationId: conversation._id.toString(), message: populatedMessage });
    return res.json({ message: populatedMessage });
  } catch (error) {
    next(error);
  }
});

router.delete('/:conversationId/messages/:messageId', authMiddleware, async (req, res, next) => {
  try {
    const conversation = await ensureConversationAccess(req.user._id, req.params.conversationId);
    if (!mongoose.isValidObjectId(req.params.messageId)) return res.status(404).json({ message: 'Message not found.' });
    const message = await Message.findOne({ _id: req.params.messageId, conversation: conversation._id });
    if (!message) return res.status(404).json({ message: 'Message not found.' });
    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You can only delete your own messages.' });
    }

    await message.deleteOne();
    if (message.attachment?.storedName) {
      const attachmentPath = path.join(path.resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads'), message.attachment.storedName);
      fs.promises.unlink(attachmentPath).catch((unlinkError) => {
        if (unlinkError.code !== 'ENOENT') console.error('Unable to remove deleted message attachment:', unlinkError.message);
      });
    }
    const latestMessage = await Message.findOne({ conversation: conversation._id }).sort({ createdAt: -1 });
    conversation.lastMessage = latestMessage?.text || latestMessage?.attachment?.fileName || '';
    conversation.lastMessageAt = latestMessage?.createdAt || conversation.createdAt;
    await conversation.save();
    emitConversationEvent(conversation, 'message-deleted', {
      conversationId: conversation._id.toString(),
      messageId: message._id.toString(),
    });
    return res.json({ message: 'Message deleted successfully.' });
  } catch (error) {
    next(error);
  }
});

router.post('/:conversationId/messages/:messageId/reactions', authMiddleware, async (req, res, next) => {
  try {
    const conversation = await ensureConversationAccess(req.user._id, req.params.conversationId);
    const { reaction } = req.body || {};
    if (!allowedReactions.has(reaction)) return res.status(400).json({ message: 'Unsupported reaction.' });
    if (!mongoose.isValidObjectId(req.params.messageId)) return res.status(404).json({ message: 'Message not found.' });

    const message = await Message.findOne({ _id: req.params.messageId, conversation: conversation._id });
    if (!message) return res.status(404).json({ message: 'Message not found.' });
    const priorIndex = message.reactionUsers.findIndex((entry) => entry.user.toString() === req.user._id.toString());
    if (priorIndex !== -1 && message.reactionUsers[priorIndex].reaction === reaction) {
      message.reactionUsers.splice(priorIndex, 1);
      message.reactions[reaction] = Math.max(0, message.reactions[reaction] - 1);
    } else {
      if (priorIndex !== -1) {
        const priorReaction = message.reactionUsers[priorIndex].reaction;
        message.reactions[priorReaction] = Math.max(0, message.reactions[priorReaction] - 1);
        message.reactionUsers.splice(priorIndex, 1);
      }
      message.reactionUsers.push({ user: req.user._id, reaction });
      message.reactions[reaction] += 1;
    }
    await message.save();
    const populatedMessage = await Message.findById(message._id).populate('sender', 'name avatar');
    emitConversationEvent(conversation, 'message-updated', { conversationId: conversation._id.toString(), message: populatedMessage });
    return res.json({ message: populatedMessage });
  } catch (error) {
    next(error);
  }
});

router.post('/:conversationId/read', authMiddleware, async (req, res, next) => {
  try {
    const conversation = await ensureConversationAccess(req.user._id, req.params.conversationId);
    if (req.body?.messageIds !== undefined && !Array.isArray(req.body.messageIds)) {
      return res.status(400).json({ message: 'Message identifiers must be supplied as an array.' });
    }
    const messageIds = req.body?.messageIds || [];
    if (messageIds.some((id) => !mongoose.isValidObjectId(id))) {
      return res.status(400).json({ message: 'One or more message identifiers are invalid.' });
    }
    const filter = { conversation: conversation._id, sender: { $ne: req.user._id } };
    if (messageIds.length) filter._id = { $in: messageIds };

    const result = await Message.updateMany(filter, {
      $addToSet: { readBy: req.user._id },
      $set: { deliveryStatus: 'read' },
    });
    const receipt = { conversationId: conversation._id.toString(), userId: req.user._id.toString(), messageIds };
    emitConversationEvent(conversation, 'read-receipt', receipt);
    return res.json({ updated: result.modifiedCount, ...receipt });
  } catch (error) {
    next(error);
  }
});

router.ensureConversationAccess = ensureConversationAccess;

module.exports = router;
