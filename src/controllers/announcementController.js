const { pool } = require('../config/database');

const sendAnnouncement = async (req, res) => {
  const { title, message, channel, user_ids } = req.body;
  if (!title || !message || !channel) return res.status(400).json({ error: 'Données requises manquantes' });

  try {
    let query, params;
    if (user_ids && user_ids.length > 0) {
      query = 'SELECT id, fullname, email, phone FROM users WHERE id = ANY($1)';
      params = [user_ids];
    } else {
      query = "SELECT id, fullname, email, phone FROM users WHERE role != 'admin'";
      params = [];
    }
    const usersRes = await pool.query(query, params);
    const recipients = usersRes.rows;

    await pool.query(
      `INSERT INTO announcements (title, message, channel, sent_by, sent_count) VALUES ($1,$2,$3,$4,$5)`,
      [title, message, channel, req.user.id, recipients.length]
    );

    res.json({ success: true, message: `Annonce envoyée à ${recipients.length} personnes` });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

const getAnnouncements = async (req, res) => {
  try {
    const result = await pool.query(`SELECT a.*, u.fullname as sent_by_name FROM announcements a LEFT JOIN users u ON u.id=a.sent_by ORDER BY a.created_at DESC LIMIT 20`);
    res.json({ announcements: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

const deleteAnnouncement = async (req, res) => {
  const { announcementId } = req.params;
  try {
    await pool.query(`DELETE FROM announcements WHERE id = $1`, [announcementId]);
    res.json({ success: true, message: 'Annonce supprimée.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

const deleteAllAnnouncements = async (req, res) => {
  try {
    await pool.query(`DELETE FROM announcements`);
    res.json({ success: true, message: 'Historique supprimé.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

module.exports = { sendAnnouncement, getAnnouncements, deleteAnnouncement, deleteAllAnnouncements };