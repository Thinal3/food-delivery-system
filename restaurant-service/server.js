const app = require('./app');
const { port } = require('./config/env');
const { checkDatabase, closePool } = require('./config/database');

async function start() {
  try {
    await checkDatabase();
    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`Restaurant service listening on port ${port}`);
    });

    let shuttingDown = false;
    async function shutdown() {
      if (shuttingDown) return;
      shuttingDown = true;
      server.close(async () => {
        await closePool();
        process.exit(0);
      });
    }
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch {
    console.error('Unable to start Restaurant service. Check database configuration and connectivity.');
    process.exit(1);
  }
}

start();