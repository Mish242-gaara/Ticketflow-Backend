// ✅ NE PAS charger dotenv sur Render (les variables sont gérées par Render)
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session); // ✅ Pour stocker les sessions dans PostgreSQL
const passport = require('passport');
const pool = require('./config/database'); // ✅ Import du pool PostgreSQL
const routes = require('./routes/index');

// ✅ Initialise l'app Express
const app = express();
const PORT = process.env.PORT || 5000;

// ✅ CORRECTION PROXY : Indispensable pour Render et express-rate-limit
app.set('trust proxy', 1);

// =============================================
// LOG DES VARIABLES D'ENVIRONNEMENT
// =============================================
console.log('🔹 [Server] NODE_ENV:', process.env.NODE_ENV);
console.log('🔹 [Server] GOOGLE_CALLBACK_URI:', process.env.GOOGLE_CALLBACK_URI);

if (!process.env.GOOGLE_CALLBACK_URI) {
  console.error('❌ GOOGLE_CALLBACK_URI est manquant sur Render !');
  console.error('🔹 Ajoutez cette variable dans Render : https://ticketflow-backend-h7m6.onrender.com/api/auth/google/callback');
}

// =============================================
// CONFIGURATION SÉCURITÉ & CORS
// =============================================
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
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Set-Cookie']
}));

// =============================================
// CONFIGURATION SESSION (avec PostgreSQL pour la production)
// =============================================
app.use(session({
  store: new pgSession({
    pool: pool, // ✅ Utilise le pool PostgreSQL
    tableName: 'user_sessions' // ✅ Table pour stocker les sessions
  }),
  secret: process.env.SESSION_SECRET || process.env.JWT_SECRET || 'ta_clé_secrète_par_défaut',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // ✅ HTTPS en production
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // ✅ 'none' pour HTTPS cross-site
    maxAge: 24 * 60 * 60 * 1000 // ✅ 24 heures
  }
}));

// =============================================
// INITIALISATION PASSPORT
// =============================================
require('./config/passport'); // ✅ Charge la configuration Passport
app.use(passport.initialize());
app.use(passport.session());

// =============================================
// MIDDLEWARES
// =============================================
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// =============================================
// LIMITATION DES REQUÊTES
// =============================================
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // ✅ Limite à 300 requêtes par fenêtre
  message: { error: 'Trop de requêtes. Veuillez réessayer plus tard.' },
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/', limiter);

// =============================================
// ROUTES ET FICHIERS STATIQUES
// =============================================
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/api', routes);

// ✅ Route de santé
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// =============================================
// GESTION DES ERREURS
// =============================================
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} introuvable` });
});

app.use((err, req, res, next) => {
  console.error('❌ Erreur serveur:', err.message);
  res.status(500).json({ error: err.message || 'Erreur serveur interne' });
});

// =============================================
// DÉMARRAGE DU SERVEUR
// =============================================
app.listen(PORT, () => {
  console.log(`\n🎟️  TicketFlow Backend — Port ${PORT}`);
  console.log(`   Mode : ${process.env.NODE_ENV || 'development'}`);
  console.log(`   URL : ${process.env.BACKEND_URL || `http://localhost:${PORT}`}`);
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