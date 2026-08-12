const { Worker } = require('bullmq');
const UAParser = require('ua-parser-js');
const geoip = require('geoip-lite');
const { createBullConnection, isRedisAvailable } = require('../config/redis');

// Only start when DB is available
let db;
try {
  db = require('../config/database');
} catch (err) {
  console.error('❌ Database not available for analytics worker:', err.message);
  process.exit(1);
}

console.log('🔄 Starting analytics worker...');

// Guard: don't start worker if Redis is unavailable
if (!isRedisAvailable()) {
  console.warn('⚠️ Analytics worker skipped — Redis is unavailable. Analytics will use direct DB inserts.');
  module.exports = null;
} else {
  let worker;
  try {
    const connection = createBullConnection();
    if (!connection) {
      throw new Error('Could not create BullMQ Redis connection');
    }

    worker = new Worker(
      'analytics',
      async (job) => {
        const { urlId, ip, userAgent, referer, timestamp } = job.data;

        // Parse User-Agent
        const ua = new UAParser(userAgent);
        const device = ua.getDevice().type || 'desktop';
        const browser = ua.getBrowser().name || 'Unknown';
        const os = ua.getOS().name || 'Unknown';

        // GeoIP lookup
        let country = 'Unknown';
        let city = 'Unknown';

        if (ip && ip !== '::1' && ip !== '127.0.0.1') {
          const geo = geoip.lookup(ip);
          if (geo) {
            country = geo.country || 'Unknown';
            city = geo.city || 'Unknown';
          }
        }

        // Insert analytics record
        await db('analytics').insert({
          url_id: urlId,
          ip_address: ip === '::1' ? '127.0.0.1' : ip,
          country,
          city,
          device,
          browser,
          os,
          referer: referer || null,
          created_at: timestamp || new Date(),
        });
      },
      {
        connection,
        concurrency: 10,
        limiter: {
          max: 100,
          duration: 1000,
        },
      }
    );

    worker.on('completed', (job) => {
      // Silent on completion for performance
    });

    worker.on('failed', (job, err) => {
      console.error(`❌ Analytics job ${job?.id} failed:`, err.message);
    });

    worker.on('ready', () => {
      console.log('✅ Analytics worker ready');
    });

    worker.on('error', (err) => {
      if (err.message && err.message.includes('max requests limit exceeded')) {
        console.error('🚫 Analytics worker: Upstash limit hit — closing worker gracefully');
        worker.close();
      }
    });

    module.exports = worker;
  } catch (err) {
    console.warn('⚠️ Analytics worker failed to start:', err.message);
    module.exports = null;
  }
}
