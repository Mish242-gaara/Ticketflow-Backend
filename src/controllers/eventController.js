// CORRECTION 1 : Importation sécurisée du pool de connexion
const database = require('../config/database');
const pool = database.pool || database;

const path = require('path');
const fs = require('fs');

// GET /api/events
const getAllEvents = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*,
        json_agg(json_build_object(
          'id', tc.id, 'name', tc.name, 'price', tc.price,
          'available_quantity', tc.available_quantity,
          'total_quantity', tc.total_quantity,
          'color', tc.color, 'description', tc.description
        ) ORDER BY tc.price ASC) AS categories
      FROM events e
      LEFT JOIN ticket_categories tc ON tc.event_id = e.id
      WHERE e.status != 'deleted'
      GROUP BY e.id
      ORDER BY e.date ASC
    `);
    res.json({ events: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/events/:slug
const getEvent = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*,
        json_agg(json_build_object(
          'id', tc.id, 'name', tc.name, 'price', tc.price,
          'total_quantity', tc.total_quantity,
          'available_quantity', tc.available_quantity,
          'color', tc.color, 'description', tc.description
        ) ORDER BY tc.price ASC) AS categories
      FROM events e
      LEFT JOIN ticket_categories tc ON tc.event_id = e.id
      WHERE e.slug = $1 AND e.status != 'deleted'
      GROUP BY e.id
    `, [req.params.slug]);
    if (!result.rows.length) return res.status(404).json({ error: 'Événement introuvable' });
    res.json({ event: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/events/id/:id  (admin - par ID)
const getEventById = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*,
        json_agg(json_build_object(
          'id', tc.id, 'name', tc.name, 'price', tc.price,
          'total_quantity', tc.total_quantity,
          'available_quantity', tc.available_quantity,
          'color', tc.color, 'description', tc.description
        )) AS categories
      FROM events e
      LEFT JOIN ticket_categories tc ON tc.event_id = e.id
      WHERE e.id = $1
      GROUP BY e.id
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Événement introuvable' });
    res.json({ event: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/events  (admin)
const createEvent = async (req, res) => {
  const { title, description, long_description, location, date, end_date, organizer, categories } = req.body;
  if (!title || !date) return res.status(400).json({ error: 'Titre et date requis' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const slug = title.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') + '-' + Date.now();

    const parsedCats = typeof categories === 'string' ? JSON.parse(categories) : (categories || []);
    const total = parsedCats.reduce((s, c) => s + (parseInt(c.total_quantity) || 0), 0);

    // Banner URL si fichier uploadé
    const bannerUrl = req.file
      ? `/uploads/banners/${req.file.filename}`
      : null;

    const evRes = await client.query(`
      INSERT INTO events (title, slug, description, long_description, location, date, end_date,
        organizer, total_tickets, available_tickets, banner_url, status, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,'active',$11) RETURNING *
    `, [title, slug, description, long_description, location, date, end_date || null,
        organizer || 'BDE ESTAM', total, bannerUrl, req.user.id]);

    const event = evRes.rows[0];

    for (const cat of parsedCats) {
      await client.query(`
        INSERT INTO ticket_categories (event_id, name, description, price, total_quantity, available_quantity, color)
        VALUES ($1,$2,$3,$4,$5,$5,$6)
      `, [event.id, cat.name, cat.description || '', parseFloat(cat.price) || 0,
          parseInt(cat.total_quantity) || 0, cat.color || '#3B82F6']);
    }

    await client.query('COMMIT');
    res.status(201).json({ event });
  } catch (err) {
    await client.query('ROLLBACK');
    // Supprimer fichier si erreur
    if (req.file) {
      fs.unlink(path.join(__dirname, '../../uploads/banners', req.file.filename), () => {});
    }
    console.error('❌ Erreur lors de la création de l\'événement:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// PUT /api/events/:id  (admin)
const updateEvent = async (req, res) => {
  const { title, description, long_description, location, date, end_date, organizer, status, categories } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Récupérer ancien banner si remplacement
    const oldEvent = await client.query('SELECT banner_url FROM events WHERE id=$1', [req.params.id]);
    const oldBanner = oldEvent.rows[0]?.banner_url;

    const bannerUrl = req.file
      ? `/uploads/banners/${req.file.filename}`
      : oldBanner; // garder l'ancien si pas de nouvel upload

    await client.query(`
      UPDATE events SET title=$1, description=$2, long_description=$3, location=$4,
        date=$5, end_date=$6, organizer=$7, status=$8, banner_url=$9, updated_at=NOW()
      WHERE id=$10
    `, [title, description, long_description, location, date, end_date || null,
        organizer, status || 'active', bannerUrl, req.params.id]);

    // Mettre à jour catégories si fournies
    if (categories) {
      const parsedCats = typeof categories === 'string' ? JSON.parse(categories) : categories;
      for (const cat of parsedCats) {
        if (cat.id) {
          await client.query(`
            UPDATE ticket_categories SET name=$1, description=$2, price=$3, color=$4, updated_at=NOW()
            WHERE id=$5 AND event_id=$6
          `, [cat.name, cat.description || '', parseFloat(cat.price) || 0, cat.color || '#3B82F6',
              cat.id, req.params.id]);
        }
      }
    }

    // Supprimer ancien banner si remplacé
    if (req.file && oldBanner) {
      const oldPath = path.join(__dirname, '../..', oldBanner);
      fs.unlink(oldPath, () => {});
    }

    const updated = await client.query(`
      SELECT e.*, json_agg(json_build_object('id',tc.id,'name',tc.name,'price',tc.price,'color',tc.color,'available_quantity',tc.available_quantity,'total_quantity',tc.total_quantity)) AS categories
      FROM events e LEFT JOIN ticket_categories tc ON tc.event_id=e.id
      WHERE e.id=$1 GROUP BY e.id
    `, [req.params.id]);

    await client.query('COMMIT');
    res.json({ event: updated.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// DELETE /api/events/:id  (admin - soft delete)
const deleteEvent = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE events SET status='deleted', updated_at=NOW() WHERE id=$1 RETURNING id, title`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Événement introuvable' });
    res.json({ message: `Événement "${result.rows[0].title}" supprimé`, id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/events/:id/attendees  (admin)
const getAttendees = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.id, t.ticket_uuid, t.holder_name, t.holder_phone, t.holder_email,
        t.status, t.scanned_at, t.created_at,
        tc.name as category_name, tc.price, tc.color,
        p.payment_status, p.method as payment_method, p.transaction_id
      FROM tickets t
      LEFT JOIN ticket_categories tc ON tc.id = t.category_id
      LEFT JOIN payments p ON p.ticket_id = t.id
      WHERE t.event_id = $1
      ORDER BY t.created_at DESC
    `, [req.params.id]);
    res.json({ attendees: result.rows, count: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/admin/events  (admin - all events including cancelled)
const getAdminEvents = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.id, e.title, e.slug, e.date, e.location, e.status, e.banner_url,
        e.total_tickets, e.available_tickets, e.organizer, e.created_at,
        COUNT(t.id) as tickets_sold,
        COUNT(t.id) FILTER (WHERE t.status='scanned' OR t.status='used') as tickets_scanned,
        COALESCE(SUM(p.amount) FILTER (WHERE p.payment_status='success' OR p.payment_status='completed'), 0) as revenue
      FROM events e
      LEFT JOIN tickets t ON t.event_id = e.id
      LEFT JOIN payments p ON p.ticket_id = t.id
      WHERE e.status != 'deleted'
      GROUP BY e.id
      ORDER BY e.created_at DESC
    `);
    res.json({ events: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getAllEvents, getEvent, getEventById, createEvent,
  updateEvent, deleteEvent, getAttendees, getAdminEvents
};