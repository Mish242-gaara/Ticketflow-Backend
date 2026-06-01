const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const passport = require('passport');
const pool = require('./config/database');
const routes = require('./routes/index');

const app = express();
const PORT = process.env.PORT || 5000;

app.set('trust proxy', 1);

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false
}));

const allowedOrigins = [
  'https://ticketflow-gold.vercel.app',
  'http://localhost:5173',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

// =============================================
// CONFIGURATION SESSION CORRIGÉE
// =============================================
app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'user_sessions',
    createTableIfMissing: true // ✅ Crucial : crée la table avec la bonne contrainte
  }),
  secret: process.env.SESSION_SECRET || 'une_cle_tres_secrete_123',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

require('./config/passport');
app.use(passport.initialize());
app.use(passport.session());

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Trop de requêtes.' }
});

app.use('/api/', limiter);
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/api', routes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use((err, req, res, next) => {
  console.error('❌ Erreur serveur:', err.stack);
  res.status(500).json({ error: 'Erreur serveur interne' });
});

app.listen(PORT, () => {
  console.log(`🎟️  TicketFlow Backend sur port ${PORT}`);
});

// =============================================
// ANTI-COLD START (Keep-Alive)
// =============================================
if (process.env.NODE_ENV === 'production') {
  const BACKEND_URL = process.env.BACKEND_URL || 'https://ticketflow-backend-h7m6.onrender.com';

  setInterval(async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/health`);
      if (response.ok) {
        console.log(`[Keep-Alive] Ping réussi : ${new Date().toISOString()}`);
      }
    } catch (error) {
      console.error('[Keep-Alive] Échec du ping:', error.message);
    }
  }, 300000); // 5 minutes

  console.log('✅ [Server] Anti-Cold Start activé.');
}

module.exports = app;