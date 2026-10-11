const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

function validateEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must be at least 8 characters long.');
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('Password must be 72 bytes or fewer.');
  }
  return bcrypt.hash(password, 12);
}

async function comparePassword(password, hash) {
  if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 72) return false;
  return bcrypt.compare(password, hash);
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (typeof secret !== 'string' || secret.trim().length < 32) {
    const error = new Error('JWT_SECRET must be configured with at least 32 characters.');
    error.statusCode = 503;
    throw error;
  }
  return secret;
}

function generateToken(userId) {
  return jwt.sign({ userId }, getJwtSecret(), {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

module.exports = {
  validateEmail,
  hashPassword,
  comparePassword,
  getJwtSecret,
  generateToken,
};
