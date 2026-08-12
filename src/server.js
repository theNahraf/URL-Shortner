const app = require('./app');
const env = require('./config/env');
const { initBlacklist } = require('./utils/blacklist');

async function start() {
  try {
    // Initialize blacklist (graceful — works with or without Redis)
    try {
      await initBlacklist();
    } catch (err) {
      console.warn('⚠️ Blacklist init failed (non-fatal):', err.message);
    }

    // Start analytics worker in same process for dev
    if (env.NODE_ENV === 'development') {
      try {
        require('./workers/analyticsWorker');
      } catch (err) {
        console.warn('⚠️ Analytics worker not started:', err.message);
      }
    }

    // Start server
    app.listen(env.PORT, () => {
      console.log(`
╔══════════════════════════════════════════════╗
║                                              ║
║   🔗 NanoURL URL Shortener                 ║
║                                              ║
║   Server:    ${env.BASE_URL.padEnd(28)}   ║
║   API Docs:  ${(env.BASE_URL + '/api-docs').padEnd(28)}   ║
║   Mode:      ${env.NODE_ENV.padEnd(28)}   ║
║                                              ║
╚══════════════════════════════════════════════╝
      `);

      // Self-ping to keep Render free tier alive (every 12 minutes)
      if (env.NODE_ENV === 'production' && env.BASE_URL) {
        const PING_INTERVAL = 12 * 60 * 1000; // 12 minutes
        const pingUrl = `${env.BASE_URL}/api/health`;
        const httpModule = pingUrl.startsWith('https') ? require('https') : require('http');

        setInterval(() => {
          httpModule.get(pingUrl, (res) => {
            console.log(`🏓 Self-ping: ${res.statusCode}`);
          }).on('error', (err) => {
            console.warn('⚠️ Self-ping failed:', err.message);
          });
        }, PING_INTERVAL);

        console.log(`🏓 Self-ping enabled — hitting ${pingUrl} every 12 minutes`);
      }
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

start();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received. Shutting down gracefully...');
  process.exit(0);
});
