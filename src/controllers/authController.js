const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database'); // Importation directe de l'instance pool

/**
 * Génère un JWT sécurisé
 */
function signToken(user) {
  const secret = process.env.JWT_SECRET || 'ticketflow_super_secret_fallback_key_1234';
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    secret,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

const register = async (req, res) => {
  const { fullname, email, phone, password } = req.body;
  
  if (!fullname || !email || !password) {
    return res.status(400).json({ error: 'Nom, email et mot de passe requis' });
  }

  try {
    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (exists.rows.length) {
      return res.status(409).json({ error: 'Cet email est déjà utilisé' });
    }

    const hashed = await bcrypt.hash(password, 12);
    
    // Ajout explicite de 'role' par défaut à 'user'
    const result = await pool.query(
      `INSERT INTO users (fullname, email, phone, password, provider, role) 
       VALUES ($1, $2, $3, $4, 'local', 'user') 
       RETURNING id, fullname, email, role`,
      [fullname, email, phone || null, hashed]
    );
    
    const user = result.rows[0];
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    console.error('Erreur inscription:', err);
    res.status(500).json({ error: 'Erreur lors de la création du compte' });
  }
};

const login = async (req, res) => {
  const { email, password } = req.body;
  
  try {
    const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    
    // Vérification existence utilisateur + présence mot de passe (sécurité pour utilisateurs Google)
    if (!result.rows.length || !result.rows[0].password) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }
    
    const valid = await bcrypt.compare(password, result.rows[0].password);
    if (!valid) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }

    const { password: _, ...user } = result.rows[0];
    res.json({ token: signToken(user), user });
  } catch (err) {
    console.error('Erreur connexion:', err);
    res.status(500).json({ error: 'Erreur lors de la connexion' });
  }
};

const me = async (req, res) => {
  // Vérification de sécurité : s'assurer que req.user est bien présent
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  try {
    const result = await pool.query('SELECT id, fullname, email, role FROM users WHERE id=$1', [req.user.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Erreur profil:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

const updateProfile = async (req, res) => {
  const { fullname, phone } = req.body;
  if (!req.user || !req.user.id) return res.status(401).json({ error: 'Non autorisé' });

  try {
    const result = await pool.query(
      'UPDATE users SET fullname=$1, phone=$2, updated_at=NOW() WHERE id=$3 RETURNING id, fullname, email, phone', 
      [fullname, phone, req.user.id]
    );
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Erreur mise à jour:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

module.exports = { register, login, me, updateProfile };