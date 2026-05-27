const { pool } = require('../config/database');

// ✅ Récupérer tous les utilisateurs
const getAllUsers = async (req, res) => {
  try {
    console.log('🔹 [getAllUsers] Début de la récupération des utilisateurs...');

    const result = await pool.query(`
      SELECT
        u.id,
        u.fullname,
        u.email,
        u.phone,
        u.role,
        u.provider,
        u.avatar_url,
        u.created_at,
        COALESCE(u.is_blocked, false) as is_blocked,
        u.unblock_at,
        COUNT(t.id) as tickets_count
      FROM users u
      LEFT JOIN tickets t ON t.user_id = u.id
      GROUP BY u.id, u.is_blocked, u.unblock_at
      ORDER BY u.created_at DESC
    `);

    console.log(`✅ [getAllUsers] ${result.rows.length} utilisateurs récupérés.`);
    res.json({ users: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('❌ [getAllUsers] Erreur:', err.message);
    res.status(500).json({
      error: 'Erreur lors de la récupération des utilisateurs.',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ✅ Supprimer un utilisateur
const deleteUser = async (req, res) => {
  const { userId } = req.params;
  const client = await pool.connect();

  try {
    console.log(`🔹 [deleteUser] Début de la suppression de l'utilisateur ${userId}...`);

    await client.query('BEGIN');

    // Supprimer les dépendances
    await client.query(`DELETE FROM tickets WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM payments WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM scans WHERE scanned_by = $1`, [userId]);
    await client.query(`DELETE FROM announcements WHERE sent_by = $1`, [userId]);

    // Supprimer l'utilisateur
    const deleteResult = await client.query(`DELETE FROM users WHERE id = $1 RETURNING id`, [userId]);

    if (deleteResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Utilisateur non trouvé.' });
    }

    await client.query('COMMIT');
    console.log(`✅ [deleteUser] Utilisateur ${userId} supprimé avec succès.`);
    res.json({ success: true, message: 'Utilisateur et ses données supprimés avec succès.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ [deleteUser] Erreur:', err.message);
    res.status(500).json({
      error: 'Erreur lors de la suppression de l\'utilisateur.',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  } finally {
    client.release();
  }
};

// ✅ Bloquer un utilisateur
const blockUser = async (req, res) => {
  const { userId } = req.params;
  const { duration } = req.body;

  try {
    console.log(`🔹 [blockUser] Blocage de l'utilisateur ${userId} pour ${duration} jours...`);

    let unblockAt = null;
    if (duration !== 'permanent') {
      unblockAt = new Date();
      unblockAt.setDate(unblockAt.getDate() + parseInt(duration));
    }

    const result = await pool.query(
      `UPDATE users SET is_blocked = true, unblock_at = $1 WHERE id = $2 RETURNING id, is_blocked, unblock_at`,
      [unblockAt, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé.' });
    }

    console.log(`✅ [blockUser] Utilisateur ${userId} bloqué jusqu'au ${unblockAt || 'jamais'}.`);
    res.json({
      success: true,
      message: 'Utilisateur bloqué avec succès.',
      user: result.rows[0]
    });
  } catch (err) {
    console.error('❌ [blockUser] Erreur:', err.message);
    res.status(500).json({
      error: 'Erreur lors du blocage de l\'utilisateur.',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ✅ Débloquer un utilisateur
const unblockUser = async (req, res) => {
  const { userId } = req.params;

  try {
    console.log(`🔹 [unblockUser] Débloquage de l'utilisateur ${userId}...`);

    const result = await pool.query(
      `UPDATE users SET is_blocked = false, unblock_at = NULL WHERE id = $1 RETURNING id, is_blocked`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé.' });
    }

    console.log(`✅ [unblockUser] Utilisateur ${userId} débloqué avec succès.`);
    res.json({
      success: true,
      message: 'Utilisateur débloqué avec succès.',
      user: result.rows[0]
    });
  } catch (err) {
    console.error('❌ [unblockUser] Erreur:', err.message);
    res.status(500).json({
      error: 'Erreur lors du débloquage de l\'utilisateur.',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

module.exports = {
  getAllUsers,
  deleteUser,
  blockUser,
  unblockUser
};