const app = require('./app');
const { port } = require('./config/env');
const { checkDatabase, closePool } = require('./config/database');
const { startSyncWorker, stopSyncWorker } = require('./services/sync.worker');

async function start() {
  try {
    await checkDatabase();
    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`Delivery service listening on port ${port}`);
    });
    startSyncWorker();
    let stopping = false;
    async function shutdown() {
      if (stopping) return;
      stopping = true;
      stopSyncWorker();
      server.close(async () => {
        await closePool();
        process.exit(0);
      });
    }
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch {
    console.error('Unable to start Delivery service. Check database configuration and connectivity.');
    process.exit(1);
  }
}

start();