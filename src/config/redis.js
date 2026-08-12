const Redis = require('ioredis');
const env = require('./env');

// Track Redis availability globally
let redisAvailable = false;

const redisOptions = {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 10) {
      console.warn('⚠️ Redis: max reconnect attempts reached. Running without Redis.');
      return null; // Stop retrying
    }
    const delay = Math.min(times * 200, 5000);
    return delay;
  },
  lazyConnect: false,
};

if (env.REDIS_URL && env.REDIS_URL.startsWith('rediss://')) {
  redisOptions.tls = { rejectUnauthorized: false };
}

const redis = new Redis(env.REDIS_URL, redisOptions);

redis.on('connect', () => {
  redisAvailable = true;
  console.log('✅ Redis connected');
});

redis.on('ready', () => {
  redisAvailable = true;
});

redis.on('error', (err) => {
  // Detect Upstash max request limit specifically
  if (err.message && err.message.includes('max requests limit exceeded')) {
    console.error('🚫 Redis Upstash limit exceeded — disabling Redis for this cycle');
    redisAvailable = false;
  } else {
    console.error('❌ Redis error:', err.message);
  }
});

redis.on('close', () => {
  redisAvailable = false;
});

redis.on('end', () => {
  redisAvailable = false;
});

/**
 * Check if Redis is currently available and usable
 */
function isRedisAvailable() {
  return redisAvailable && redis.status === 'ready';
}

/**
 * Safe Redis command wrapper — returns null/fallback on failure instead of throwing
 */
async function safeRedisGet(key) {
  if (!isRedisAvailable()) return null;
  try {
    return await redis.get(key);
  } catch (err) {
    console.warn('⚠️ Redis GET failed:', err.message);
    redisAvailable = false;
    return null;
  }
}

async function safeRedisSet(key, value, ...args) {
  if (!isRedisAvailable()) return;
  try {
    await redis.set(key, value, ...args);
  } catch (err) {
    console.warn('⚠️ Redis SET failed:', err.message);
    redisAvailable = false;
  }
}

async function safeRedisDel(key) {
  if (!isRedisAvailable()) return;
  try {
    await redis.del(key);
  } catch (err) {
    console.warn('⚠️ Redis DEL failed:', err.message);
    redisAvailable = false;
  }
}

// Separate connection for BullMQ (it needs its own)
const createBullConnection = () => {
  if (!isRedisAvailable()) return null;
  
  const options = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
  
  if (env.REDIS_URL && env.REDIS_URL.startsWith('rediss://')) {
    options.tls = { rejectUnauthorized: false };
  }
  
  return new Redis(env.REDIS_URL, options);
};

module.exports = { redis, createBullConnection, isRedisAvailable, safeRedisGet, safeRedisSet, safeRedisDel };
