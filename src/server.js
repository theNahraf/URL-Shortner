const app = require('./app');
const env = require('./config/env');
const { initBlacklist } = require('./utils/blacklist');

async function start() {
  try {
    // Initialize blacklist
    await initBlacklist();

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
