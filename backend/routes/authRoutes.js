const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { validateEmail, hashPassword, getJwtSecret, generateToken } = require('../utils/security');
const { authMiddleware } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimit');

const router = express.Router();
const authAttemptLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  message: 'Too many authentication attempts. Please try again later.',
});

router.post('/register', authAttemptLimit, async (req, res, next) => {
  try {
    getJwtSecret();
    const { name, email, password } = req.body || {};

    if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Name, email, and password are required.' });
    }

    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedName.length < 2 || normalizedName.length > 80) {
      return res.status(400).json({ message: 'Name must be between 2 and 80 characters.' });
    }
    if (!validateEmail(normalizedEmail)) {
      return res.status(400).json({ message: 'Please provide a valid email address.' });
    }

    if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
      return res.status(400).json({ message: 'Password must be at least 8 characters and no more than 72 bytes.' });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    const passwordHash = await hashPassword(password);
    const user = await User.create({
      name: normalizedName,
      email: normalizedEmail,
      passwordHash,
      avatar: normalizedName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'CU',
      status: 'Available',
    });

    const token = generateToken(user._id);

    return res.status(201).json({
      token,
      user: user.toPublicJSON(),
    });
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.email) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }
    next(error);
  }
});

router.post('/login', authAttemptLimit, async (req, res, next) => {
  try {
    getJwtSecret();
    const { email, password } = req.body || {};

    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const token = generateToken(user._id);

    return res.status(200).json({
      token,
      user: user.toPublicJSON(),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  return res.json({ user: req.user.toPublicJSON() });
});

router.get('/users', authMiddleware, async (req, res, next) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const filter = { _id: { $ne: req.user._id } };
    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: escapedSearch, $options: 'i' } },
        { email: { $regex: escapedSearch, $options: 'i' } },
      ];
    }
    const users = await User.find(filter).select('name email avatar status').sort({ name: 1 }).limit(100);
    return res.json({ users });
  } catch (error) {
    return next(error);
  }
});

router.put('/profile', authMiddleware, async (req, res, next) => {
  try {
    const { name, status, avatar } = req.body || {};
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) {
        return res.status(400).json({ message: 'Name must be between 2 and 80 characters.' });
      }
      user.name = name.trim();
    }
    if (status !== undefined) {
      if (typeof status !== 'string' || status.length > 140) {
        return res.status(400).json({ message: 'Status must be 140 characters or fewer.' });
      }
      user.status = status.trim();
    }
    if (avatar !== undefined) {
      if (typeof avatar !== 'string' || avatar.length > 500) {
        return res.status(400).json({ message: 'Avatar must be a URL string of 500 characters or fewer.' });
      }
      user.avatar = avatar.trim();
    }
    await user.save();

    return res.json({ user: user.toPublicJSON() });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', authMiddleware, (req, res) => {
  return res.status(200).json({ message: 'Logged out successfully.' });
});

module.exports = router;
