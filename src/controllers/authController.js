const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// CORRECTION ICI : Importation sécurisée du pool pour éviter le crash "undefined (reading 'query')"
const database = require('../config/database');
const pool = database.pool || database;

function signToken(user) {
  // Sécurité supplémentaire : Si JWT_SECRET est absent de Render, on utilise une clé de secours temporaire
  const secret = process.env.JWT_SECRET || 'ticketflow_super_secret_fallback_key_1234';
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    secret,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// POST /api/auth/register
const register = async (req, res) => {
  const { fullname, email, phone, password } = req.body;
  if (!fullname || !email || !password)
    return res.status(400).json({ error: 'Nom, email et mot de passe requis' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Mot de passe trop court (min 6 caractères)' });

  try {
    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (exists.rows.length)
      return res.status(409).json({ error: 'Cet email est déjà utilisé' });

    const hashed = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (fullname, email, phone, password, provider)
       VALUES ($1,$2,$3,$4,'local') RETURNING id, fullname, email, phone, role, avatar_url, provider, created_at`,
      [fullname, email, phone || null, hashed]
    );
    const user = result.rows[0];
    const token = signToken(user);
    res.status(201).json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/auth/login
const login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email et mot de passe requis' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    if (!result.rows.length)
      return res.status(401).json({ error: 'Identifiants incorrects' });

    const user = result.rows[0];

    // Compte Google sans mot de passe
    if (!user.password)
      return res.status(401).json({ error: 'Ce compte utilise la connexion Google. Cliquez sur "Continuer avec Google".' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Identifiants incorrects' });

    const { password: _, ...safeUser } = user;
    const token = signToken(safeUser);
    res.json({ token, user: safeUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/auth/me
const me = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, fullname, email, phone, role, avatar_url, provider, created_at FROM users WHERE id=$1',
      [req.user.id]
    );
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/auth/profile
const updateProfile = async (req, res) => {
  const { fullname, phone } = req.body;
  try {
    const result = await pool.query(
      `UPDATE users SET fullname=$1, phone=$2, updated_at=NOW() WHERE id=$3
       RETURNING id, fullname, email, phone, role, avatar_url, provider`,
      [fullname, phone, req.user.id]
    );
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/admin/users  (admin)
const getAllUsers = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.fullname, u.email, u.phone, u.role, u.provider,
        u.avatar_url, u.created_at,
        COUNT(t.id) as tickets_count
      FROM users u
      LEFT JOIN tickets t ON t.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    res.json({ users: result.rows, count: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/admin/announcements  (admin)
const sendAnnouncement = async (req, res) => {
  const { title, message, channel, user_ids } = req.body;
  if (!title || !message || !channel)
    return res.status(400).json({ error: 'title, message et channel requis' });

  try {
    // Récupérer les destinataires
    let query, params;
    if (user_ids && user_ids.length > 0) {
      query = 'SELECT id, fullname, email, phone FROM users WHERE id = ANY($1)';
      params = [user_ids];
    } else {
      query = 'SELECT id, fullname, email, phone FROM users WHERE role != \'admin\'';
      params = [];
    }
    const usersRes = await pool.query(query, params);
    const recipients = usersRes.rows;

    // Construire les liens WhatsApp pour chaque destinataire
    const whatsappLinks = [];
    const emailList = [];

    for (const user of recipients) {
      if (channel === 'whatsapp' && user.phone) {
        const phone = user.phone.replace(/\s/g,'').replace('+','').replace(/^0/,'242');
        const text = encodeURIComponent(`*${title}*\n\nBonjour ${user.fullname.split(' ')[0]} 👋\n\n${message}\n\n— TicketFlow ESTAM`);
        whatsappLinks.push({ name: user.fullname, phone: user.phone, url: `https://wa.me/${phone}?text=${text}` });
      }
      if (channel === 'email' && user.email) {
        emailList.push({ name: user.fullname, email: user.email });
      }
    }

    // Enregistrer l'annonce en base
    await pool.query(
      `INSERT INTO announcements (title, message, channel, sent_by, sent_count)
       VALUES ($1,$2,$3,$4,$5)`,
      [title, message, channel, req.user.id, recipients.length]
    );

    res.json({
      success: true,
      count: recipients.length,
      whatsappLinks: channel === 'whatsapp' ? whatsappLinks : [],
      emailList:     channel === 'email'    ? emailList    : [],
      message: `Annonce préparée pour ${recipients.length} utilisateur(s)`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/admin/announcements
const getAnnouncements = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.*, u.fullname as sent_by_name
      FROM announcements a LEFT JOIN users u ON u.id=a.sent_by
      ORDER BY a.created_at DESC LIMIT 20
    `);
    res.json({ announcements: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { register, login, me, updateProfile, getAllUsers, sendAnnouncement, getAnnouncements };