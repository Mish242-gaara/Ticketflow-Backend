require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const rateLimit = require('express-rate-limit');
const path     = require('path');
const passport = require('./config/passport');
const routes   = require('./routes/index');

const app  = express();
const PORT = process.env.PORT || 5000;

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(passport.initialize());

app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 300, message: { error: 'Trop de requêtes.' } }));

// Raw pour webhook Flutterwave avant express.json
app.use('/api/webhooks/flutterwave', express.raw({ type: '*/*' }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Fichiers statiques (banners)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api', routes);

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.use((req, res) => res.status(404).json({ error: `Route ${req.method} ${req.path} introuvable` }));
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Fichier trop volumineux (max 5MB)' });
  console.error('❌', err.message);
  res.status(500).json({ error: err.message || 'Erreur serveur' });
});

app.listen(PORT, () => {
  console.log(`\n🎟️  TicketFlow Backend — http://localhost:${PORT}`);
  console.log(`   Google OAuth : http://localhost:${PORT}/api/auth/google`);
  console.log(`   Env : ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = app;
