const app = require('./app');
const { port } = require('./config/env');
const { checkDatabase, closePool } = require('./config/database');

async function start() {
  try {
    // Do not announce the service as started until MySQL can answer a query.
    await checkDatabase();
    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`Auth service listening on port ${port}`);
    });

    async function shutdown() {
      // Stop accepting requests before closing the shared database pool.
      server.close(async () => {
        await closePool();
        process.exit(0);
      });
    }

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error('Unable to start auth service:', error.message);
    process.exit(1);
  }
}

start();