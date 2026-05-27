const { pool } = require('../config/database');

// Récupérer tous les utilisateurs avec une requête simplifiée
const getAllUsers = async (req, res) => {
  try {
    // Requête simplifiée : on récupère les infos de base des utilisateurs
    const query = `
      SELECT id, fullname, email, phone, role, provider, avatar_url, created_at, is_blocked, unblock_at
      FROM users
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query);
    
    // On renvoie les données même si le tableau est vide
    res.json({ users: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('❌ Erreur détaillée getAllUsers:', err);
    res.status(500).json({ error: 'Erreur lors de la récupération des utilisateurs.' });
  }
};

const deleteUser = async (req, res) => {
  const { userId } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM tickets WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM payments WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM scans WHERE scanned_by = $1`, [userId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await client.query('COMMIT');
    res.json({ success: true, message: 'Utilisateur supprimé.' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Erreur lors de la suppression.' });
  } finally {
    client.release();
  }
};

const blockUser = async (req, res) => {
  const { userId } = req.params;
  const { duration } = req.body;
  try {
    let unblockAt = null;
    if (duration !== 'permanent') {
      unblockAt = new Date();
      unblockAt.setDate(unblockAt.getDate() + parseInt(duration));
    }
    await pool.query(`UPDATE users SET is_blocked = true, unblock_at = $1 WHERE id = $2`, [unblockAt, userId]);
    res.json({ success: true, message: 'Utilisateur bloqué.' });
  } catch (err) { res.status(500).json({ error: 'Erreur lors du blocage.' }); }
};

const unblockUser = async (req, res) => {
  const { userId } = req.params;
  try {
    await pool.query(`UPDATE users SET is_blocked = false, unblock_at = NULL WHERE id = $1`, [userId]);
    res.json({ success: true, message: 'Utilisateur débloqué.' });
  } catch (err) { res.status(500).json({ error: 'Erreur lors du déblocage.' }); }
};

module.exports = { getAllUsers, deleteUser, blockUser, unblockUser };