const { pool } = require('../config/database');

// Supprimer une annonce spécifique
const deleteAnnouncement = async (req, res) => {
  const { announcementId } = req.params;

  try {
    await pool.query(`DELETE FROM announcements WHERE id = $1`, [announcementId]);
    res.json({
      success: true,
      message: 'Annonce supprimée avec succès.'
    });
  } catch (err) {
    console.error('❌ Erreur suppression annonce:', err);
    res.status(500).json({
      error: 'Erreur lors de la suppression de l\'annonce.',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Supprimer TOUTES les annonces (historique complet)
const deleteAllAnnouncements = async (req, res) => {
  try {
    await pool.query(`DELETE FROM announcements`);
    res.json({
      success: true,
      message: 'Historique des annonces supprimé avec succès.'
    });
  } catch (err) {
    console.error('❌ Erreur suppression historique annonces:', err);
    res.status(500).json({
      error: 'Erreur lors de la suppression de l\'historique des annonces.',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

module.exports = {
  deleteAnnouncement,
  deleteAllAnnouncements
};