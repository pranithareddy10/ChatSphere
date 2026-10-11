function createRateLimiter({ windowMs, maxRequests, message }) {
  const requests = new Map();
  let requestsSinceCleanup = 0;

  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    let entry = requests.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      requests.set(key, entry);
    }

    entry.count += 1;
    requestsSinceCleanup += 1;
    if (requestsSinceCleanup >= 256) {
      for (const [ip, value] of requests) {
        if (value.resetAt <= now) requests.delete(ip);
      }
      requestsSinceCleanup = 0;
    }

    res.setHeader('RateLimit-Limit', String(maxRequests));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, maxRequests - entry.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > maxRequests) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
      return res.status(429).json({ message });
    }
    return next();
  };
}

module.exports = { createRateLimiter };
