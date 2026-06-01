const pool = require('../config/database');

// ✅ Envoyer une annonce
const sendAnnouncement = async (req, res) => {
  const { title, message, channel, user_ids } = req.body;

  // ✅ Validation des données requises
  if (!title || !message || !channel) {
    return res.status(400).json({ error: 'Titre, message et canal sont requis' });
  }

  try {
    let query, params;

    // ✅ Sélectionne les destinataires
    if (user_ids && user_ids.length > 0) {
      query = 'SELECT id, fullname, email, phone FROM users WHERE id = ANY($1)';
      params = [user_ids];
    } else {
      query = "SELECT id, fullname, email, phone FROM users WHERE role != 'admin'";
      params = [];
    }

    const usersRes = await pool.query(query, params);
    const recipients = usersRes.rows;

    // ✅ Enregistre l'annonce dans la base de données
    const announcementRes = await pool.query(
      `INSERT INTO announcements (title, message, channel, sent_by, sent_count, user_ids)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [title, message, channel, req.user.id, recipients.length, user_ids || []]
    );

    // ✅ Renvoie les données nécessaires pour le frontend
    const announcement = announcementRes.rows[0];

    // ✅ Génère les liens WhatsApp ou la liste d'emails
    let whatsappLinks = [];
    let emailList = [];

    if (channel === 'whatsapp') {
      whatsappLinks = recipients
        .filter(u => u.phone)
        .map(u => ({
          name: u.fullname,
          phone: u.phone,
          url: `https://wa.me/${u.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(`${title}\n\n${message}`)}`
        }));
    } else if (channel === 'email') {
      emailList = recipients
        .filter(u => u.email)
        .map(u => ({
          name: u.fullname,
          email: u.email
        }));
    }

    res.json({
      success: true,
      message: `Annonce envoyée à ${recipients.length} personne(s)`,
      announcement,
      whatsappLinks,
      emailList,
      count: recipients.length
    });

  } catch (err) {
    console.error('❌ Erreur envoi annonce:', err);
    res.status(500).json({
      error: 'Erreur serveur lors de l\'envoi de l\'annonce',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ✅ Récupérer toutes les annonces
const getAnnouncements = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        a.*,
        u.fullname as sent_by_name,
        u.email as sent_by_email
      FROM announcements a
      LEFT JOIN users u ON u.id = a.sent_by
      ORDER BY a.created_at DESC
      LIMIT 20
    `);

    res.json({
      success: true,
      announcements: result.rows
    });

  } catch (err) {
    console.error('❌ Erreur récupération annonces:', err);
    res.status(500).json({
      error: 'Erreur serveur lors de la récupération des annonces',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ✅ Supprimer une annonce spécifique
const deleteAnnouncement = async (req, res) => {
  const { announcementId } = req.params;

  try {
    const result = await pool.query(
      `DELETE FROM announcements WHERE id = $1 RETURNING *`,
      [announcementId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Annonce introuvable' });
    }

    res.json({
      success: true,
      message: 'Annonce supprimée avec succès',
      deletedAnnouncement: result.rows[0]
    });

  } catch (err) {
    console.error('❌ Erreur suppression annonce:', err);
    res.status(500).json({
      error: 'Erreur serveur lors de la suppression de l\'annonce',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ✅ Supprimer toutes les annonces
const deleteAllAnnouncements = async (req, res) => {
  try {
    await pool.query(`DELETE FROM announcements`);

    res.json({
      success: true,
      message: 'Toutes les annonces ont été supprimées'
    });

  } catch (err) {
    console.error('❌ Erreur suppression historique annonces:', err);
    res.status(500).json({
      error: 'Erreur serveur lors de la suppression de l\'historique',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

module.exports = {
  sendAnnouncement,
  getAnnouncements,
  deleteAnnouncement,
  deleteAllAnnouncements
};