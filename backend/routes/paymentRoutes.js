const express = require('express');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { authMiddleware } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimit');

const router = express.Router();
const paymentAttemptLimit = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  maxRequests: 20,
  message: 'Too many demo payment attempts. Please try again later.',
});

function parseDemoAmount(amount) {
  if (typeof amount !== 'number' && typeof amount !== 'string') return null;
  const amountText = typeof amount === 'string' ? amount.trim() : String(amount);
  if (!/^\d+(?:\.\d{1,2})?$/.test(amountText)) return null;
  const numericAmount = Number(amountText);
  if (!Number.isFinite(numericAmount) || numericAmount < 0.01 || numericAmount > 1000000) return null;
  return numericAmount;
}

router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const transactions = await Transaction.find({
      $or: [{ sender: req.user._id }, { recipient: req.user._id }],
    })
      .populate('sender', 'name email avatar')
      .populate('recipient', 'name email avatar')
      .sort({ createdAt: -1 });

    return res.json({ transactions });
  } catch (error) {
    next(error);
  }
});

router.post('/demo', paymentAttemptLimit, authMiddleware, async (req, res, next) => {
  try {
    const { recipientId, amount, currency = 'USD', paymentNote = '' } = req.body || {};

    if (!recipientId) {
      return res.status(400).json({ message: 'Recipient is required.' });
    }

    if (!mongoose.isValidObjectId(recipientId)) {
      return res.status(400).json({ message: 'A valid recipient is required.' });
    }
    if (recipientId.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot send a payment to yourself.' });
    }

    const numericAmount = parseDemoAmount(amount);
    if (numericAmount === null) {
      return res.status(400).json({ message: 'Amount must be between 0.01 and 1,000,000.00 with at most two decimal places.' });
    }
    if (currency !== 'USD') {
      return res.status(400).json({ message: 'Only USD is supported by the demo payment interface.' });
    }
    if (typeof paymentNote !== 'string' || paymentNote.length > 200) {
      return res.status(400).json({ message: 'Payment note must be 200 characters or fewer.' });
    }

    const recipient = await User.findById(recipientId);
    if (!recipient) {
      return res.status(404).json({ message: 'Recipient not found.' });
    }

    const transaction = await Transaction.create({
      sender: req.user._id,
      recipient: recipientId,
      amount: numericAmount,
      currency,
      paymentNote,
      status: 'pending',
      paymentMode: 'demo',
      providerReference: `DEMO-${crypto.randomUUID()}`,
    });

    return res.status(201).json({ transaction, warning: 'Demo transaction only. No real money is transferred.' });
  } catch (error) {
    next(error);
  }
});

router.get('/:transactionId', authMiddleware, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.transactionId)) {
      return res.status(404).json({ message: 'Transaction not found.' });
    }
    const transaction = await Transaction.findById(req.params.transactionId)
      .populate('sender', 'name email avatar')
      .populate('recipient', 'name email avatar');

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found.' });
    }

    const isOwner = transaction.sender._id.toString() === req.user._id.toString() || transaction.recipient._id.toString() === req.user._id.toString();
    if (!isOwner) {
      return res.status(403).json({ message: 'You do not have access to this transaction.' });
    }

    return res.json({ transaction });
  } catch (error) {
    next(error);
  }
});

router.post('/:transactionId/verify', paymentAttemptLimit, authMiddleware, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.transactionId)) {
      return res.status(404).json({ message: 'Transaction not found.' });
    }
    const transaction = await Transaction.findById(req.params.transactionId);
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found.' });
    }

    if (transaction.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only the sender can verify the payment.' });
    }
    if (transaction.paymentMode !== 'demo') {
      return res.status(400).json({ message: 'This transaction cannot use demo verification.' });
    }
    if (transaction.status !== 'pending') {
      return res.status(409).json({ message: 'Only pending demo transactions can be verified.' });
    }

    transaction.status = 'success';
    await transaction.save();

    return res.json({
      transaction,
      message: 'Demo payment verified successfully. No real money was transferred.',
      simulated: true,
    });
  } catch (error) {
    next(error);
  }
});

router.parseDemoAmount = parseDemoAmount;

module.exports = router;
