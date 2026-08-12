const { redis, isRedisAvailable } = require('../config/redis');

const BLACKLIST_KEY = 'url:blacklist:domains';

// Default blacklisted domains (known malware/phishing)
const DEFAULT_BLACKLIST = [
  'malware.com',
  'phishing-site.com',
  'scam-domain.net',
];

// In-memory fallback blacklist (used when Redis is unavailable)
const localBlacklist = new Set(DEFAULT_BLACKLIST);

/**
 * Initialize the blacklist with default domains
 */
async function initBlacklist() {
  if (!isRedisAvailable()) {
    console.log(`⚠️ Redis unavailable — using in-memory blacklist with ${localBlacklist.size} domains`);
    return;
  }

  try {
    const exists = await redis.exists(BLACKLIST_KEY);
    if (!exists) {
      if (DEFAULT_BLACKLIST.length > 0) {
        await redis.sadd(BLACKLIST_KEY, ...DEFAULT_BLACKLIST);
      }
      console.log(`✅ Blacklist initialized with ${DEFAULT_BLACKLIST.length} domains`);
    }
  } catch (err) {
    console.warn(`⚠️ Redis blacklist init failed — using in-memory fallback: ${err.message}`);
  }
}

/**
 * Check if a domain is blacklisted
 * @param {string} url 
 * @returns {Promise<boolean>}
 */
async function isBlacklisted(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();

    // Try Redis first
    if (isRedisAvailable()) {
      try {
        return await redis.sismember(BLACKLIST_KEY, hostname);
      } catch (err) {
        // Redis failed — fall through to local check
      }
    }

    // Fallback: in-memory check
    return localBlacklist.has(hostname);
  } catch {
    return false;
  }
}

/**
 * Add a domain to the blacklist
 * @param {string} domain 
 */
async function addToBlacklist(domain) {
  const d = domain.toLowerCase();
  localBlacklist.add(d); // Always update in-memory

  if (isRedisAvailable()) {
    try {
      await redis.sadd(BLACKLIST_KEY, d);
    } catch (err) {
      console.warn('⚠️ Redis blacklist add failed:', err.message);
    }
  }
}

/**
 * Remove a domain from the blacklist
 * @param {string} domain 
 */
async function removeFromBlacklist(domain) {
  const d = domain.toLowerCase();
  localBlacklist.delete(d); // Always update in-memory

  if (isRedisAvailable()) {
    try {
      await redis.srem(BLACKLIST_KEY, d);
    } catch (err) {
      console.warn('⚠️ Redis blacklist remove failed:', err.message);
    }
  }
}

module.exports = { initBlacklist, isBlacklisted, addToBlacklist, removeFromBlacklist };
