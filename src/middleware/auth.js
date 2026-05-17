const jwt = require('jsonwebtoken');

// CORRECTION 1 : Importation sécurisée du pool (sans déstructuration erronée)
const database = require('../config/database');
const pool = database.pool || database;

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token manquant ou invalide' });
    }

    const token = authHeader.split(' ')[1];
    
    // CORRECTION 2 : Harmonisation de la clé secrète avec celle de authController
    const secret = process.env.JWT_SECRET || 'ticketflow_super_secret_fallback_key_1234';
    const decoded = jwt.verify(token, secret);

    // Exécution de la requête sur le bon pool PostgreSQL
    const result = await pool.query('SELECT id, fullname, email, role FROM users WHERE id = $1', [decoded.id]);
    if (!result.rows.length) {
      return res.status(401).json({ error: 'Utilisateur introuvable' });
    }

    req.user = result.rows[0];
    next();
  } catch (err) {
    // Petit log serveur pour debugger rapidement sur Render si nécessaire
    console.error('❌ Erreur de validation du Token:', err.message);
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
};

const adminMiddleware = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  }
  next();
};

module.exports = { authMiddleware, adminMiddleware };