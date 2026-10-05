const express = require('express');
const helmet = require('helmet');
const authRoutes = require('./routes/auth.routes');
const { checkDatabase } = require('./config/database');

const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));
app.get('/ready', async (req, res, next) => {
  try {
    await checkDatabase();
    return res.status(200).json({ status: 'ready' });
  } catch (error) {
    return next(error);
  }
});
app.use('/api/auth', authRoutes);

app.use((req, res) => res.status(404).json({ error: 'Route not found.' }));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  let statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  if (error.type === 'entity.too.large') statusCode = 413;
  if (error.type === 'entity.parse.failed') statusCode = 400;
  if (statusCode === 500) console.error('Unhandled Auth service request failure.');
  return res.status(statusCode).json({
    error: statusCode === 500
      ? 'Internal server error.'
      : statusCode === 413
        ? 'Request body is too large.'
        : statusCode === 400 && error.type === 'entity.parse.failed'
          ? 'Request body contains invalid JSON.'
          : error.message,
  });
});

module.exports = app;