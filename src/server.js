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

// =============================================
// LOG DES VARIABLES D'ENVIRONNEMENT (pour débogage)
// =============================================
console.log('🔹 [Server] NODE_ENV:', process.env.NODE_ENV);
console.log('🔹 [Server] FRONTEND_URL:', process.env.FRONTEND_URL);
console.log('🔹 [Server] BACKEND_URL:', process.env.BACKEND_URL);
console.log('🔹 [Server] GOOGLE_CALLBACK_URI:', process.env.GOOGLE_CALLBACK_URI);

// ✅ Vérifie que GOOGLE_CALLBACK_URI est défini
if (!process.env.GOOGLE_CALLBACK_URI) {
  console.error('❌ GOOGLE_CALLBACK_URI est manquant dans les variables d\'environnement de Render !');
  console.error('   → Définissez-le dans Render → Settings → Environment Variables');
}

// =============================================
// CONFIGURATION SÉCURITÉ
// =============================================
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false
}));

// =============================================
// CONFIGURATION CORS
// =============================================
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
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
    domain: process.env.NODE_ENV === 'production' ? '.onrender.com' : undefined
  }
}));

// =============================================
// MIDDLEWARES
// =============================================
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Initialisation de Passport
app.use(passport.initialize());
app.use(passport.session());

// =============================================
// LIMITATION DES REQUÊTES
// =============================================
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Trop de requêtes. Veuillez réessayer plus tard.' }
}));

// =============================================
// FICHIERS STATIQUES
// =============================================
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// =============================================
// ROUTES
// =============================================
app.use('/api', routes);

// Route de santé
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
    googleCallbackUri: process.env.GOOGLE_CALLBACK_URI
  });
});

// =============================================
// GESTION DES ERREURS
// =============================================
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} introuvable` });
});

app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Fichier trop volumineux (max 5MB)' });
  }
  console.error('❌ Erreur serveur:', err.message);
  res.status(500).json({
    error: err.message || 'Erreur serveur interne',
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// =============================================
// ANTI-COLD START
// =============================================
if (process.env.NODE_ENV === 'production') {
  setInterval(async () => {
    try {
      const response = await fetch(`${process.env.BACKEND_URL || 'https://ticketflow-backend-9xkf.onrender.com'}/health`);
      if (response.ok) {
        console.log(`[Keep-Alive] Ping réussi : ${new Date().toISOString()}`);
      }
    } catch (error) {
      console.error('[Keep-Alive] Échec du ping:', error.message);
    }
  }, 300000);
}

// =============================================
// DÉMARRAGE DU SERVEUR
// =============================================
app.listen(PORT, () => {
  console.log(`\n🎟️  TicketFlow Backend — Port ${PORT}`);
  console.log(`   Mode : ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Frontend URL : ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
  console.log(`   Backend URL : ${process.env.BACKEND_URL || 'http://localhost:5000'}`);
  console.log(`   Google OAuth Callback : ${process.env.GOOGLE_CALLBACK_URI || 'Non défini'}`);
  console.log(`   Accès : http://localhost:${PORT}\n`);
});

module.exports = app;