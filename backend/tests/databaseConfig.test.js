const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { connectDB, diagnoseConnectionError, sanitizeErrorMessage } = require('../config/db');
const { errorHandler } = require('../middleware/errorHandler');

test('missing or placeholder MongoDB URIs do not start a connection attempt', async () => {
  const previousUri = process.env.MONGODB_URI;
  const originalConnect = mongoose.connect;
  let attemptedConnection = false;
  mongoose.connect = async () => {
    attemptedConnection = true;
  };

  try {
    delete process.env.MONGODB_URI;
    assert.equal(await connectDB(), false);
    process.env.MONGODB_URI = 'mongodb+srv://<username>:<password>@<cluster>.mongodb.net/chatsphere';
    assert.equal(await connectDB(), false);
    assert.equal(attemptedConnection, false);
  } finally {
    mongoose.connect = originalConnect;
    if (previousUri === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = previousUri;
  }
});

test('server errors are logged with redacted MongoDB URIs and safe API messages', () => {
  const originalConsoleError = console.error;
  const logEntries = [];
  const response = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  console.error = (...args) => logEntries.push(args.join(' '));

  try {
    errorHandler(
      new Error('Database failed for mongodb+srv://sensitive-user:sensitive-password@cluster.example/db'),
      {},
      response,
      () => {},
    );
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.body, { message: 'Unexpected server error.' });
    assert.equal(logEntries.join(' ').includes('sensitive-password'), false);
    assert.equal(logEntries.join(' ').includes('mongodb+srv://sensitive-user'), false);
    assert.equal(logEntries.join(' ').includes('[MongoDB connection string redacted]'), true);
  } finally {
    console.error = originalConsoleError;
  }
});

test('Atlas connection failures provide safe, actionable diagnostic categories', () => {
  assert.deepEqual(
    diagnoseConnectionError({ name: 'Error', code: 'EBADRESP', message: 'querySrv EBADRESP private-host' }),
    {
      category: 'dns_resolution_failed',
      action: 'Check the Atlas cluster hostname, DNS resolver, and network/VPN settings; SRV lookup did not succeed.',
    },
  );
  assert.equal(
    diagnoseConnectionError({ name: 'MongoServerError', code: 18, message: 'Authentication failed' }).category,
    'authentication_failed',
  );
  assert.equal(
    diagnoseConnectionError({ name: 'MongoParseError', message: 'bad URI' }).category,
    'invalid_connection_uri',
  );
});

test('MongoDB diagnostics preserve useful messages while redacting connection strings', () => {
  const message = 'failed mongodb+srv://private-user:private-password@cluster.example/db?retryWrites=true due to querySrv EBADRESP';
  const safeMessage = sanitizeErrorMessage(message);

  assert.match(safeMessage, /querySrv EBADRESP/);
  assert.doesNotMatch(safeMessage, /private-user|private-password|mongodb\+srv:\/\//);
  assert.match(safeMessage, /\[MongoDB connection string redacted\]/);
});
