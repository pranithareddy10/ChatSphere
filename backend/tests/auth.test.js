const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { hashPassword, comparePassword, generateToken, validateEmail } = require('../utils/security');

test('hashPassword creates a secure hash', async () => {
  const hash = await hashPassword('StrongPass123');
  assert.ok(hash.length > 20);
  const isMatch = await comparePassword('StrongPass123', hash);
  assert.equal(isMatch, true);
});

test('generateToken produces a non-empty token', () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'unit-test-secret-with-at-least-32-characters';
  try {
    const token = generateToken('user-123');
    assert.ok(token.length > 20);
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('generateToken refuses an absent or weak secret', () => {
  const previousSecret = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  try {
    assert.throws(() => generateToken('user-123'), /JWT_SECRET must be configured/);
  } finally {
    if (previousSecret !== undefined) process.env.JWT_SECRET = previousSecret;
  }
});

test('bcrypt validation rejects mismatched password', async () => {
  const hash = await bcrypt.hash('demo12345', 10);
  const result = await comparePassword('wrongpass', hash);
  assert.equal(result, false);
});

test('email validation rejects non-string input', () => {
  assert.equal(validateEmail('prani@example.com'), true);
  assert.equal(validateEmail('not-an-email'), false);
  assert.equal(validateEmail({ toString: () => 'prani@example.com' }), false);
});

test('passwords exceeding bcrypt input capacity are rejected', async () => {
  const tooLongPassword = 'a'.repeat(73);
  await assert.rejects(hashPassword(tooLongPassword), /72 bytes or fewer/);
  assert.equal(await comparePassword(tooLongPassword, 'unused-hash'), false);
});
