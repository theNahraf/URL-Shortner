const { redis, isRedisAvailable } = require('../config/redis');
const env = require('../config/env');

/**
 * Token Bucket Rate Limiter backed by Redis
 * 
 * Supports per-user (authenticated) and per-IP (anonymous) limiting.
 * Different limits per subscription tier.
 */

const TIER_LIMITS = {
  unauthenticated: {
    shorten: { tokens: 5, interval: 60 },      // 5/min
    redirect: { tokens: 50, interval: 60 },     // 50/min
    analytics: { tokens: 5, interval: 60 },     // 5/min
    general: { tokens: 30, interval: 60 },      // 30/min
  },
  free: {
    shorten: { tokens: 10, interval: 60 },      // 10/min
    redirect: { tokens: 100, interval: 60 },    // 100/min
    analytics: { tokens: 20, interval: 60 },    // 20/min
    general: { tokens: 60, interval: 60 },      // 60/min
  },
  pro: {
    shorten: { tokens: 60, interval: 60 },      // 60/min
    redirect: { tokens: 1000, interval: 60 },   // 1000/min
    analytics: { tokens: 100, interval: 60 },   // 100/min
    general: { tokens: 300, interval: 60 },     // 300/min
  },
  business: {
    shorten: { tokens: 200, interval: 60 },     // 200/min
    redirect: { tokens: 5000, interval: 60 },   // 5000/min
    analytics: { tokens: 500, interval: 60 },   // 500/min
    general: { tokens: 1000, interval: 60 },    // 1000/min
  },
};

/**
 * Lua script for atomic token bucket operation in Redis.
 * Returns: [allowed (0/1), remaining tokens, reset time in seconds]
 */
const TOKEN_BUCKET_SCRIPT = `
  local key = KEYS[1]
  local max_tokens = tonumber(ARGV[1])
  local interval = tonumber(ARGV[2])
  local now = tonumber(ARGV[3])

  local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
  local tokens = tonumber(bucket[1])
  local last_refill = tonumber(bucket[2])

  if tokens == nil then
    tokens = max_tokens
    last_refill = now
  end

  local elapsed = now - last_refill
  local refill = math.floor(elapsed / 1000 * max_tokens / interval)
  
  if refill > 0 then
    tokens = math.min(max_tokens, tokens + refill)
    last_refill = now
  end

  local allowed = 0
  if tokens > 0 then
    tokens = tokens - 1
    allowed = 1
  end

  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', last_refill)
  redis.call('EXPIRE', key, interval * 2)

  local reset_in = math.ceil(interval / max_tokens)
  return {allowed, tokens, reset_in}
`;

/**
 * Create rate limiter middleware for a specific action type
 * @param {'shorten'|'redirect'|'analytics'|'general'} actionType
 */
function createRateLimiter(actionType = 'general') {
  return async (req, res, next) => {
    if (!env.RATE_LIMIT_ENABLED) return next();
    if (!isRedisAvailable()) return next(); // Fail-open: skip rate limiting when Redis is down
    try {
      const tier = req.user ? (req.user.plan_type || 'free') : 'unauthenticated';
      const limits = TIER_LIMITS[tier]?.[actionType] || TIER_LIMITS.unauthenticated.general;

      const identifier = req.user ? `user:${req.user.id}` : `ip:${req.ip}`;
      const key = `ratelimit:${actionType}:${identifier}`;

      const result = await redis.eval(
        TOKEN_BUCKET_SCRIPT,
        1,
        key,
        limits.tokens,
        limits.interval,
        Date.now()
      );

      const [allowed, remaining, resetIn] = result;

      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': limits.tokens,
        'X-RateLimit-Remaining': Math.max(0, remaining),
        'X-RateLimit-Reset': resetIn,
      });

      if (!allowed) {
        return res.status(429).json({
          success: false,
          error: 'Too many requests. Please try again later.',
          retryAfter: resetIn,
        });
      }

      next();
    } catch (err) {
      // If Redis is down, allow the request (fail-open)
      console.error('Rate limiter error:', err.message);
      next();
    }
  };
}

module.exports = { createRateLimiter, TIER_LIMITS };
