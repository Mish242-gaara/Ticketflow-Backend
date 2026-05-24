// ✅ NE PAS charger dotenv sur Render (les variables sont gérées par Render)
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const session = require('express-session');
const passport = require('./config/passport');
const routes = require('./routes/index');

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
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Set-Cookie']
}));

// =============================================
// CONFIGURATION SESSION
// =============================================
app.use(session({
  secret: process.env.JWT_SECRET || 'ta_clé_secrète_par_défaut',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // 'none' nécessaire pour HTTPS cross-site
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// =============================================
// MIDDLEWARES
// =============================================
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(passport.initialize());
app.use(passport.session());

// =============================================
// LIMITATION DES REQUÊTES
// =============================================
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Trop de requêtes. Veuillez réessayer plus tard.' }
});

app.use('/api/', limiter);

// =============================================
// ROUTES ET FICHIERS
// =============================================
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/api', routes);

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
// DÉMARRAGE
// =============================================
app.listen(PORT, () => {
  console.log(`\n🎟️  TicketFlow Backend — Port ${PORT}`);
  console.log(`   Mode : ${process.env.NODE_ENV || 'development'}`);
});

// =============================================
// ANTI-COLD START (Keep-Alive)
// =============================================
if (process.env.NODE_ENV === 'production') {
  const BACKEND_URL = process.env.BACKEND_URL || 'https://ticketflow-backend-9xkf.onrender.com';
  
  setInterval(async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/health`);
      if (response.ok) {
        console.log(`[Keep-Alive] Ping réussi : ${new Date().toISOString()}`);
      }
    } catch (error) {
      console.error('[Keep-Alive] Échec du ping:', error.message);
    }
  }, 300000); // 300 000 ms = 5 minutes
  
  console.log('✅ [Server] Anti-Cold Start activé.');
}

module.exports = app;