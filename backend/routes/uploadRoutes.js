const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const multer = require('multer');
const { authMiddleware } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimit');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

const router = express.Router();
const uploadAttemptLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 30,
  message: 'Too many file uploads. Please try again later.',
});
const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDir),
  filename: (_req, file, callback) => {
    const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    callback(null, `${Date.now()}-${require('node:crypto').randomUUID()}-${safeName}`);
  },
});

const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'audio/mpeg',
  'audio/webm',
  'audio/ogg',
  'audio/wav',
  'audio/mp4',
  'audio/aac',
]);
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (allowedMimeTypes.has(file.mimetype)) return callback(null, true);
    const error = new Error('Unsupported file type. Allowed: images, PDFs, documents, and voice notes.');
    error.statusCode = 415;
    return callback(error);
  },
});

function removeUploadedFile(file) {
  if (file) fs.promises.unlink(file.path).catch((error) => console.error('Unable to remove rejected upload:', error.message));
}

router.post('/', uploadAttemptLimit, authMiddleware, (req, res, next) => {
  upload.single('file')(req, res, (uploadError) => {
    if (uploadError) {
      if (uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ message: 'File exceeds the 10 MB upload limit.' });
      }
      return next(uploadError);
    }
    return next();
  });
}, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
    const { conversationId, messageType, replyTo = null } = req.body || {};
    if (!mongoose.isValidObjectId(conversationId)) {
      removeUploadedFile(req.file);
      return res.status(400).json({ message: 'A valid conversation identifier is required.' });
    }
    if (!['image', 'document', 'voice'].includes(messageType)) {
      removeUploadedFile(req.file);
      return res.status(400).json({ message: 'Unsupported attachment message type.' });
    }
    const conversation = await Conversation.findOne({ _id: conversationId, members: req.user._id });
    if (!conversation) {
      removeUploadedFile(req.file);
      return res.status(403).json({ message: 'You are not authorized to upload to this conversation.' });
    }
    if (replyTo) {
      const replyTarget = await Message.findOne({ _id: replyTo, conversation: conversation._id });
      if (!replyTarget) {
        removeUploadedFile(req.file);
        return res.status(400).json({ message: 'The replied-to message does not exist in this conversation.' });
      }
    }

    const message = await Message.create({
      conversation: conversation._id,
      sender: req.user._id,
      messageType,
      text: '',
      replyTo,
      readBy: [req.user._id],
      attachment: {
        fileName: req.file.originalname,
        storedName: req.file.filename,
        mimeType: req.file.mimetype,
        url: `/api/uploads/${encodeURIComponent(req.file.filename)}`,
        size: req.file.size,
      },
    });
    conversation.lastMessage = req.file.originalname;
    conversation.lastMessageAt = message.createdAt;
    await conversation.save();
    const populatedMessage = await Message.findById(message._id)
      .populate('sender', 'name avatar')
      .populate({ path: 'replyTo', populate: { path: 'sender', select: 'name avatar' } });
    const io = global.__io;
    const eventPayload = {
      conversationId: conversation._id.toString(),
      message: populatedMessage,
    };
    if (io) {
      io.to(conversation._id.toString()).emit('new-message', eventPayload);
      conversation.members.forEach((memberId) => io.to(`user:${memberId.toString()}`).emit('conversation-message', eventPayload));
    }
    return res.status(201).json({ message: populatedMessage });
  } catch (error) {
    if (req.file) removeUploadedFile(req.file);
    return next(error);
  }
});

router.get('/:storedName', authMiddleware, async (req, res, next) => {
  try {
    const storedName = path.basename(req.params.storedName);
    const message = await Message.findOne({ 'attachment.storedName': storedName });
    if (!message) return res.status(404).json({ message: 'Attachment not found.' });

    const conversation = await Conversation.exists({ _id: message.conversation, members: req.user._id });
    if (!conversation) return res.status(403).json({ message: 'You are not authorized to access this attachment.' });

    const filePath = path.join(uploadDir, storedName);
    return res.download(filePath, message.attachment.fileName, (error) => {
      if (error && !res.headersSent) next(error);
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
