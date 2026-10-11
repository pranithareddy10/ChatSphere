const test = require('node:test');
const assert = require('node:assert/strict');
const { createRateLimiter } = require('../middleware/rateLimit');
const paymentRoutes = require('../routes/paymentRoutes');

function responseRecorder() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('rate limiter allows the configured number of requests and rejects the next', () => {
  const limit = createRateLimiter({ windowMs: 60_000, maxRequests: 1, message: 'Slow down.' });
  const req = { ip: 'test-client' };
  const firstResponse = responseRecorder();
  let nextCalled = false;

  limit(req, firstResponse, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(firstResponse.headers['RateLimit-Remaining'], '0');

  const secondResponse = responseRecorder();
  limit(req, secondResponse, () => { nextCalled = true; });
  assert.equal(secondResponse.statusCode, 429);
  assert.equal(secondResponse.body.message, 'Slow down.');
  assert.ok(Number(secondResponse.headers['Retry-After']) >= 1);
});

test('rate limiter keeps separate client buckets', () => {
  const limit = createRateLimiter({ windowMs: 60_000, maxRequests: 1, message: 'Slow down.' });
  const firstResponse = responseRecorder();
  const secondResponse = responseRecorder();

  limit({ ip: 'client-one' }, firstResponse, () => {});
  limit({ ip: 'client-two' }, secondResponse, () => {});

  assert.equal(firstResponse.statusCode, 200);
  assert.equal(secondResponse.statusCode, 200);
});

test('demo payment amounts accept valid cents without floating-point rounding errors', () => {
  assert.equal(paymentRoutes.parseDemoAmount(0.29), 0.29);
  assert.equal(paymentRoutes.parseDemoAmount('125.00'), 125);
  assert.equal(paymentRoutes.parseDemoAmount('0.001'), null);
  assert.equal(paymentRoutes.parseDemoAmount('1e2'), null);
  assert.equal(paymentRoutes.parseDemoAmount(true), null);
});
