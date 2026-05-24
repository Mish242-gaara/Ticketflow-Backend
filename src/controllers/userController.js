const { pool } = require('../config/database');

// Récupérer tous les utilisateurs
const getAllUsers = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.fullname, u.email, u.phone, u.role, u.provider,
        u.avatar_url, u.created_at, u.is_blocked, u.unblock_at,
        COUNT(t.id) as tickets_count
      FROM users u
      LEFT JOIN tickets t ON t.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    res.json({ users: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('❌ Erreur getAllUsers:', err);
    res.status(500).json({ error: 'Erreur lors de la récupération des utilisateurs.' });
  }
};

// Supprimer un utilisateur
const deleteUser = async (req, res) => {
  const { userId } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Supprimer les dépendances avant l'utilisateur
    await client.query(`DELETE FROM tickets WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM payments WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM scans WHERE scanned_by = $1`, [userId]);

    // Supprimer l'utilisateur
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);

    await client.query('COMMIT');
    res.json({ success: true, message: 'Utilisateur et ses données supprimés avec succès.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur suppression utilisateur:', err);
    res.status(500).json({ error: 'Erreur lors de la suppression.' });
  } finally {
    client.release();
  }
};

// Bloquer un utilisateur
const blockUser = async (req, res) => {
  const { userId } = req.params;
  const { duration } = req.body; 

  try {
    let unblockAt = null;
    if (duration !== 'permanent') {
      unblockAt = new Date();
      unblockAt.setDate(unblockAt.getDate() + parseInt(duration));
    }

    await pool.query(
      `UPDATE users SET is_blocked = true, unblock_at = $1 WHERE id = $2`,
      [unblockAt, userId]
    );

    res.json({ success: true, message: 'Utilisateur bloqué.' });
  } catch (err) {
    console.error('❌ Erreur blocage utilisateur:', err);
    res.status(500).json({ error: 'Erreur lors du blocage.' });
  }
};

// Débloquer un utilisateur
const unblockUser = async (req, res) => {
  const { userId } = req.params;

  try {
    await pool.query(
      `UPDATE users SET is_blocked = false, unblock_at = NULL WHERE id = $1`,
      [userId]
    );

    res.json({ success: true, message: 'Utilisateur débloqué avec succès.' });
  } catch (err) {
    console.error('❌ Erreur débloquage utilisateur:', err);
    res.status(500).json({ error: 'Erreur lors du débloquage.' });
  }
};

module.exports = {
  getAllUsers,
  deleteUser,
  blockUser,
  unblockUser
};