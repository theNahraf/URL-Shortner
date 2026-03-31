const db = require('../config/database');
const { redis } = require('../config/redis');
const SnowflakeGenerator = require('../utils/snowflake');
const base62 = require('../utils/base62');
const { validateUrl } = require('../utils/urlValidator');
const { isBlacklisted } = require('../utils/blacklist');
const { AppError } = require('../middleware/errorHandler');
const env = require('../config/env');
const { Queue } = require('bullmq');
const { createBullConnection } = require('../config/redis');

// Initialize Snowflake generator
const snowflake = new SnowflakeGenerator(env.MACHINE_ID);

// Analytics queue
let analyticsQueue;
try {
  analyticsQueue = new Queue('analytics', {
    connection: createBullConnection(),
    defaultJobOptions: {
      removeOnComplete: 1000,
      removeOnFail: 5000,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    },
  });
} catch (err) {
  console.warn('⚠️ Analytics queue not initialized:', err.message);
}

// Plan limits for link creation
const PLAN_LIMITS = {
  free: 100,
  pro: Infinity,
  business: Infinity,
};

const CACHE_TTL = 3600; // 1 hour
const CACHE_PREFIX = 'url:';

/**
 * Shorten a URL
 */
async function shortenUrl(longUrl, options = {}, user = null) {
  // Validate URL
  const validation = validateUrl(longUrl);
  if (!validation.valid) {
    throw new AppError(validation.error, 400, 'INVALID_URL');
  }

  // Check blacklist
  const blocked = await isBlacklisted(longUrl);
  if (blocked) {
    throw new AppError('This URL has been blocked for security reasons', 403, 'URL_BLACKLISTED');
  }

  // Check plan limits
  if (user) {
    const limit = PLAN_LIMITS[user.plan_type] || PLAN_LIMITS.free;
    if (limit !== Infinity) {
      const userData = await db('users').where({ id: user.id }).first();
      if (userData.links_created_this_month >= limit) {
        throw new AppError(
          `You've reached your monthly limit of ${limit} links. Upgrade your plan for more.`,
          403,
          'LIMIT_REACHED'
        );
      }
    }
  }

  let shortCode;

  // Custom alias or generated code
  if (options.customAlias) {
    // Validate custom alias
    if (!/^[a-zA-Z0-9_-]{3,30}$/.test(options.customAlias)) {
      throw new AppError(
        'Custom alias must be 3-30 characters and contain only letters, numbers, hyphens, and underscores',
        400,
        'INVALID_ALIAS'
      );
    }

    // Check if custom alias requires pro+ plan
    if (user && user.plan_type === 'free') {
      throw new AppError('Custom aliases require a Pro or Business plan', 403, 'UPGRADE_REQUIRED');
    }

    // Check availability
    const existing = await db('urls').where({ short_code: options.customAlias }).first();
    if (existing) {
      throw new AppError('This custom alias is already taken', 409, 'ALIAS_TAKEN');
    }

    shortCode = options.customAlias;
  } else {
    // Generate unique 5-character short code using crypto
    const charset = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const crypto = require('crypto');
    let isUnique = false;
    
    while (!isUnique) {
      shortCode = '';
      const randomBytes = crypto.randomBytes(5);
      for (let i = 0; i < 5; i++) {
        shortCode += charset[randomBytes[i] % charset.length];
      }
      // Guarantee uniqueness
      const existing = await db('urls').where({ short_code: shortCode }).first();
      if (!existing) {
        isUnique = true;
      }
    }
  }

  // Hash password if provided
  let passwordHash = null;
  if (options.password) {
    const bcrypt = require('bcrypt');
    passwordHash = await bcrypt.hash(options.password, 10);
  }

  // Insert into database
  const [url] = await db('urls')
    .insert({
      short_code: shortCode,
      long_url: longUrl,
      user_id: user ? user.id : null,
      custom_alias: !!options.customAlias,
      password_hash: passwordHash,
      expires_at: options.expiresAt || null,
      one_time: !!options.oneTime,
      title: options.title || null,
    })
    .returning('*');

  // Cache in Redis
  await redis.set(`${CACHE_PREFIX}${shortCode}`, longUrl, 'EX', CACHE_TTL);

  // Increment user's monthly link count
  if (user) {
    await db('users').where({ id: user.id }).increment('links_created_this_month', 1);
  }

  return {
    id: url.id,
    shortCode: url.short_code,
    shortUrl: `${env.SHORT_BASE_URL}/${url.short_code}`,
    longUrl: url.long_url,
    expiresAt: url.expires_at,
    oneTime: url.one_time,
    hasPassword: !!url.password_hash,
    createdAt: url.created_at,
  };
}

/**
 * Resolve a short code to its long URL (for redirect)
 */
async function resolveUrl(shortCode, requestMeta = {}) {
  // 1. Check Redis cache first
  let longUrl = await redis.get(`${CACHE_PREFIX}${shortCode}`);
  let urlRecord = null;

  if (longUrl) {
    // Still need to check expiry and one-time status from DB
    urlRecord = await db('urls').where({ short_code: shortCode }).first();
  } else {
    // 2. Cache miss — query DB
    urlRecord = await db('urls').where({ short_code: shortCode }).first();
    if (urlRecord) {
      longUrl = urlRecord.long_url;
      // Cache for next time
      await redis.set(`${CACHE_PREFIX}${shortCode}`, longUrl, 'EX', CACHE_TTL);
    }
  }

  if (!urlRecord || !urlRecord.is_active) {
    throw new AppError('Short URL not found', 404, 'URL_NOT_FOUND');
  }

  // Check expiration
  if (urlRecord.expires_at && new Date(urlRecord.expires_at) < new Date()) {
    await redis.del(`${CACHE_PREFIX}${shortCode}`);
    throw new AppError('This link has expired', 410, 'URL_EXPIRED');
  }

  // Check password protection
  if (urlRecord.password_hash) {
    if (!requestMeta.password) {
      throw new AppError('This link is password protected', 401, 'PASSWORD_REQUIRED');
    }
    const bcrypt = require('bcrypt');
    const valid = await bcrypt.compare(requestMeta.password, urlRecord.password_hash);
    if (!valid) {
      throw new AppError('Invalid password', 401, 'INVALID_PASSWORD');
    }
  }

  // Handle one-time links
  if (urlRecord.one_time) {
    await db('urls').where({ id: urlRecord.id }).update({ is_active: false });
    await redis.del(`${CACHE_PREFIX}${shortCode}`);
  }

  // Increment click count (fast, inline)
  await db('urls').where({ id: urlRecord.id }).increment('click_count', 1);

  // Queue async analytics
  if (analyticsQueue) {
    await analyticsQueue.add('track-click', {
      urlId: urlRecord.id,
      ip: requestMeta.ip,
      userAgent: requestMeta.userAgent,
      referer: requestMeta.referer,
      timestamp: new Date().toISOString(),
    });
  }

  return { longUrl, statusCode: urlRecord.one_time ? 302 : 301 };
}

/**
 * Get all links for a user
 */
async function getUserLinks(userId, page = 1, limit = 20, search = '', status = '') {
  const offset = (page - 1) * limit;

  let query = db('urls')
    .where({ user_id: userId })
    .orderBy('created_at', 'desc');

  let countQuery = db('urls').where({ user_id: userId });

  if (status === 'active') {
    query = query.where({ is_active: true });
    countQuery = countQuery.where({ is_active: true });
  } else if (status === 'inactive') {
    query = query.where({ is_active: false });
    countQuery = countQuery.where({ is_active: false });
  }

  if (search) {
    query = query.where(function () {
      this.where('long_url', 'ilike', `%${search}%`)
        .orWhere('short_code', 'ilike', `%${search}%`)
        .orWhere('title', 'ilike', `%${search}%`);
    });
    countQuery = countQuery.where(function () {
      this.where('long_url', 'ilike', `%${search}%`)
        .orWhere('short_code', 'ilike', `%${search}%`)
        .orWhere('title', 'ilike', `%${search}%`);
    });
  }

  const [links, [{ count }]] = await Promise.all([
    query.limit(limit).offset(offset),
    countQuery.count(),
  ]);

  const total = parseInt(count, 10);

  return {
    links: links.map(formatLink),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Get a single link by ID
 */
async function getLinkById(linkId, userId) {
  const link = await db('urls').where({ id: linkId, user_id: userId }).first();
  if (!link) {
    throw new AppError('Link not found', 404);
  }
  return formatLink(link);
}

/**
 * Update a link
 */
async function updateLink(linkId, userId, updates) {
  const link = await db('urls').where({ id: linkId, user_id: userId }).first();
  if (!link) {
    throw new AppError('Link not found', 404);
  }

  const allowedUpdates = {};

  if (updates.longUrl) {
    const validation = validateUrl(updates.longUrl);
    if (!validation.valid) throw new AppError(validation.error, 400);
    allowedUpdates.long_url = updates.longUrl;
  }

  if (updates.title !== undefined) allowedUpdates.title = updates.title;
  if (updates.expiresAt !== undefined) allowedUpdates.expires_at = updates.expiresAt;
  if (updates.isActive !== undefined) allowedUpdates.is_active = updates.isActive;

  if (updates.password) {
    const bcrypt = require('bcrypt');
    allowedUpdates.password_hash = await bcrypt.hash(updates.password, 10);
  }

  allowedUpdates.updated_at = new Date();

  const [updated] = await db('urls')
    .where({ id: linkId, user_id: userId })
    .update(allowedUpdates)
    .returning('*');

  // Invalidate cache
  await redis.del(`${CACHE_PREFIX}${link.short_code}`);

  // Re-cache if URL changed
  if (updates.longUrl) {
    await redis.set(`${CACHE_PREFIX}${link.short_code}`, updates.longUrl, 'EX', CACHE_TTL);
  }

  return formatLink(updated);
}

/**
 * Delete a link
 */
async function deleteLink(linkId, userId) {
  const link = await db('urls').where({ id: linkId, user_id: userId }).first();
  if (!link) {
    throw new AppError('Link not found', 404);
  }

  await db('urls').where({ id: linkId }).del();
  await redis.del(`${CACHE_PREFIX}${link.short_code}`);

  // Decrement user's monthly count
  await db('users').where({ id: userId }).decrement('links_created_this_month', 1);

  return { deleted: true };
}

/**
 * Format a link for API response
 */
function formatLink(link) {
  return {
    id: link.id,
    shortCode: link.short_code,
    shortUrl: `${env.SHORT_BASE_URL}/${link.short_code}`,
    longUrl: link.long_url,
    title: link.title,
    customAlias: link.custom_alias,
    hasPassword: !!link.password_hash,
    expiresAt: link.expires_at,
    oneTime: link.one_time,
    isActive: link.is_active,
    clickCount: link.click_count,
    createdAt: link.created_at,
    updatedAt: link.updated_at,
  };
}

module.exports = {
  shortenUrl,
  resolveUrl,
  getUserLinks,
  getLinkById,
  updateLink,
  deleteLink,
};
