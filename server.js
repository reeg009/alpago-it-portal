require('./src/env');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const migrate = require('./src/migrate');
const { authenticate } = require('./src/auth');
const { pool } = require('./src/db');

const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      scriptSrc: ["'self'"],
    },
  },
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
});

app.use('/api/auth', require('./src/routes/auth'));
app.use('/api', authenticate);
app.use('/api', require('./src/routes/portal'));
app.use('/api/assets', require('./src/routes/assets'));
app.use('/api/tickets', require('./src/routes/tickets'));
app.use('/api/employees', require('./src/routes/employees'));
app.use('/api/licenses', require('./src/routes/licenses'));
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Always revalidate app files so new deploys show up immediately (ETag keeps it cheap)
app.use(express.static(path.join(__dirname, 'public'), {
  index: 'index.html',
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));
app.get('/{*splat}', (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(__dirname, 'public', 'index.html')); });

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Server error' : err.message });
});

const PORT = process.env.PORT || 3000;
migrate()
  .then(() => app.listen(PORT, () => console.log(`Alpago IT Portal listening on :${PORT}`)))
  .catch((e) => { console.error('Startup failed:', e); process.exit(1); });
