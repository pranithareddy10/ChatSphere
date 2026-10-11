const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getJwtSecret } = require('../utils/security');

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ message: 'Authentication required.' });
  }

  let secret;
  try {
    secret = getJwtSecret();
  } catch (error) {
    return res.status(error.statusCode || 503).json({ message: error.message });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, secret);
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }

  try {
    const user = await User.findById(decoded.userId).select('-passwordHash');
    if (!user) return res.status(401).json({ message: 'User not found or token is invalid.' });

    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { authMiddleware };
