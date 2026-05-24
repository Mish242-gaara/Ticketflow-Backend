const { pool } = require('../config/database');

// Supprimer un utilisateur
const deleteUser = async (req, res) => {
  const { userId } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Supprimer les tickets de l'utilisateur
    await client.query(`DELETE FROM tickets WHERE user_id = $1`, [userId]);

    // Supprimer les paiements de l'utilisateur
    await client.query(`DELETE FROM payments WHERE user_id = $1`, [userId]);

    // Supprimer les scans effectués par l'utilisateur
    await client.query(`DELETE FROM scans WHERE scanned_by = $1`, [userId]);

    // Supprimer l'utilisateur
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);

    await client.query('COMMIT');
    res.json({
      success: true,
      message: 'Utilisateur et ses données supprimés avec succès.'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur suppression utilisateur:', err);
    res.status(500).json({
      error: 'Erreur lors de la suppression de l\'utilisateur.',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  } finally {
    client.release();
  }
};

// Bloquer un utilisateur
const blockUser = async (req, res) => {
  const { userId } = req.params;
  const { duration } = req.body; // durée en jours ou "permanent"

  try {
    let unblockAt = null;

    if (duration !== 'permanent') {
      unblockAt = new Date();
      unblockAt.setDate(unblockAt.getDate() + parseInt(duration));
    }

    await pool.query(
      `UPDATE users
       SET is_blocked = true, unblock_at = $1
       WHERE id = $2`,
      [unblockAt, userId]
    );

    res.json({
      success: true,
      message: `Utilisateur bloqué ${duration === 'permanent' ? 'indéfiniment' : `jusqu'au ${unblockAt.toLocaleDateString('fr-FR')}`}.`
    });
  } catch (err) {
    console.error('❌ Erreur blocage utilisateur:', err);
    res.status(500).json({
      error: 'Erreur lors du blocage de l\'utilisateur.',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Débloquer un utilisateur
const unblockUser = async (req, res) => {
  const { userId } = req.params;

  try {
    await pool.query(
      `UPDATE users
       SET is_blocked = false, unblock_at = NULL
       WHERE id = $1`,
      [userId]
    );

    res.json({
      success: true,
      message: 'Utilisateur débloqué avec succès.'
    });
  } catch (err) {
    console.error('❌ Erreur débloquage utilisateur:', err);
    res.status(500).json({
      error: 'Erreur lors du débloquage de l\'utilisateur.',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

module.exports = {
  deleteUser,
  blockUser,
  unblockUser
};