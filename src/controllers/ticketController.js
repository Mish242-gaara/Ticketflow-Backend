const { v4: uuidv4 } = require('uuid');

// CORRECTION 1 : Importation sécurisée du pool de connexion
const database = require('../config/database');
const pool = database.pool || database;

const { createTicketQR } = require('../services/qrService');
const { generateTicketPDF } = require('../services/pdfService');
const { initiateFlutterwavePayment, checkPaymentStatus } = require('../services/paymentService');

// POST /api/tickets/reserve
const reserveTicket = async (req, res) => {
  const { event_id, category_id, holder_name, holder_phone, holder_email, payment_method } = req.body;
  if (!event_id || !category_id || !holder_name || !holder_phone)
    return res.status(400).json({ error: 'event_id, category_id, holder_name et holder_phone requis' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const catRes = await client.query(
      'SELECT tc.*, e.title as event_title FROM ticket_categories tc JOIN events e ON e.id=tc.event_id WHERE tc.id=$1 AND tc.event_id=$2 FOR UPDATE',
      [category_id, event_id]
    );
    if (!catRes.rows.length) return res.status(404).json({ error: 'Catégorie introuvable' });
    const cat = catRes.rows[0];
    if (cat.available_quantity <= 0) return res.status(400).json({ error: 'Plus de places disponibles dans cette catégorie' });

    const ticketUuid = uuidv4();
    const { token, qrImage } = await createTicketQR(ticketUuid);
    const isFree = parseFloat(cat.price) === 0;

    const tickRes = await client.query(`
      INSERT INTO tickets (ticket_uuid, user_id, event_id, category_id, qr_code, qr_token,
        holder_name, holder_phone, holder_email, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *
    `, [ticketUuid, req.user?.id || null, event_id, category_id, qrImage, token,
        holder_name, holder_phone, holder_email || null, isFree ? 'active' : 'pending']);

    const ticket = tickRes.rows[0];

    await client.query('UPDATE ticket_categories SET available_quantity=available_quantity-1 WHERE id=$1', [category_id]);
    await client.query('UPDATE events SET available_tickets=available_tickets-1 WHERE id=$1', [event_id]);

    await client.query('COMMIT');

    if (isFree) {
      return res.status(201).json({ ticket, category: cat, payment_required: false, message: 'Ticket réservé avec succès !' });
    }

    // Initier paiement Flutterwave
    const payment = await initiateFlutterwavePayment({
      ticketId: ticket.id,
      userId: req.user?.id || null,
      amount: cat.price,
      phone: holder_phone,
      method: payment_method || 'mtn',
      holderName: holder_name,
      holderEmail: holder_email || '',
      eventTitle: cat.event_title,
    });

    res.status(201).json({ ticket, category: cat, payment_required: true, payment,
      message: 'Ticket réservé. Confirmez le paiement Mobile Money.' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// GET /api/tickets/check-payment/:txRef
const checkPayment = async (req, res) => {
  try {
    const payment = await checkPaymentStatus(req.params.txRef);
    if (!payment) return res.status(404).json({ error: 'Transaction introuvable' });

    let ticket = null;
    if (payment.payment_status === 'success') {
      const t = await pool.query(`
        SELECT t.*, tc.name as category_name, tc.price, tc.color
        FROM tickets t LEFT JOIN ticket_categories tc ON tc.id=t.category_id
        WHERE t.id=$1
      `, [payment.ticket_id]);
      ticket = t.rows[0];
    }
    res.json({ payment, ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/tickets/my
const myTickets = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.*, e.title as event_title, e.date as event_date, e.location as event_location,
        e.banner_url, tc.name as category_name, tc.price, tc.color,
        p.payment_status, p.method as payment_method, p.transaction_id
      FROM tickets t
      LEFT JOIN events e ON e.id=t.event_id
      LEFT JOIN ticket_categories tc ON tc.id=t.category_id
      LEFT JOIN payments p ON p.ticket_id=t.id
      WHERE t.user_id=$1
      ORDER BY t.created_at DESC
    `, [req.user.id]);
    res.json({ tickets: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/tickets/:uuid
const getTicket = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.*, e.title as event_title, e.date as event_date, e.location as event_location,
        e.organizer, tc.name as category_name, tc.price, tc.color, tc.description as category_description
      FROM tickets t
      LEFT JOIN events e ON e.id=t.event_id
      LEFT JOIN ticket_categories tc ON tc.id=t.category_id
      WHERE t.ticket_uuid=$1
    `, [req.params.uuid]);
    if (!result.rows.length) return res.status(404).json({ error: 'Ticket introuvable' });
    res.json({ ticket: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/tickets/:uuid/download
const downloadTicket = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.*, e.title as event_title, e.date, e.location, e.organizer,
        tc.name as category_name, tc.price, tc.color
      FROM tickets t
      LEFT JOIN events e ON e.id=t.event_id
      LEFT JOIN ticket_categories tc ON tc.id=t.category_id
      WHERE t.ticket_uuid=$1
    `, [req.params.uuid]);
    if (!result.rows.length) return res.status(404).json({ error: 'Ticket introuvable' });

    const ticket = result.rows[0];
    const event = { title: ticket.event_title, date: ticket.date, location: ticket.location, organizer: ticket.organizer };
    const category = { name: ticket.category_name, price: ticket.price, color: ticket.color };
    const pdfBuffer = await generateTicketPDF(ticket, event, category);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ticket-${ticket.ticket_uuid.slice(0,8)}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/verify-ticket  (admin scanner only)
const verifyTicket = async (req, res) => {
  const { qr_data } = req.body;
  if (!qr_data) return res.status(400).json({ error: 'qr_data requis' });

  const client = await pool.connect();
  try {
    let parsed;
    try { parsed = JSON.parse(qr_data); }
    catch { return res.json({ result: 'INVALID', message: '⛔ QR code invalide' }); }

    const { uuid, token } = parsed;
    if (!uuid || !token) return res.json({ result: 'INVALID', message: '⛔ QR code malformé' });

    const { verifyQRToken } = require('../services/qrService');
    if (!verifyQRToken(token, uuid)) {
      await pool.query(
        `INSERT INTO scans (ticket_id, scanned_by, result, ip_address) SELECT id,$1,'INVALID',$2 FROM tickets WHERE ticket_uuid=$3`,
        [req.user.id, req.ip, uuid]
      );
      return res.json({ result: 'INVALID', message: '⛔ QR code non authentique' });
    }

    await client.query('BEGIN');

    const tickRes = await client.query(`
      SELECT t.*, e.title as event_title, tc.name as category_name, tc.color
      FROM tickets t
      LEFT JOIN events e ON e.id=t.event_id
      LEFT JOIN ticket_categories tc ON tc.id=t.category_id
      WHERE t.ticket_uuid=$1 FOR UPDATE
    `, [uuid]);

    if (!tickRes.rows.length) {
      await client.query('ROLLBACK');
      return res.json({ result: 'INVALID', message: '⛔ Ticket introuvable en base' });
    }

    const ticket = tickRes.rows[0];

    // HARMONISATION : Gestion des statuts 'used' ou 'scanned' selon les fichiers de migration
    if (ticket.status === 'used' || ticket.status === 'scanned') {
      await client.query('ROLLBACK');
      await pool.query(`INSERT INTO scans (ticket_id, scanned_by, result, ip_address) VALUES ($1,$2,'USED',$3)`,
        [ticket.id, req.user.id, req.ip]);
      return res.json({
        result: 'USED',
        message: '🔴 Ticket déjà utilisé',
        ticket: { holder_name: ticket.holder_name, scanned_at: ticket.scanned_at, category_name: ticket.category_name },
      });
    }

    if (ticket.status !== 'active') {
      await client.query('ROLLBACK');
      return res.json({ result: 'INVALID', message: `⛔ Ticket non valide (statut: ${ticket.status})` });
    }

    await client.query(
      `UPDATE tickets SET status='scanned', scanned_at=NOW(), scanned_by=$1, updated_at=NOW() WHERE id=$2`,
      [req.user.id, ticket.id]
    );
    await client.query(`INSERT INTO scans (ticket_id, scanned_by, result, ip_address) VALUES ($1,$2,'VALID',$3)`,
      [ticket.id, req.user.id, req.ip]);

    await client.query('COMMIT');

    res.json({
      result: 'VALID',
      message: '✅ Ticket valide — Entrée autorisée',
      ticket: {
        holder_name: ticket.holder_name,
        holder_phone: ticket.holder_phone,
        category_name: ticket.category_name,
        color: ticket.color,
        event_title: ticket.event_title,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// GET /api/admin/stats
const getAdminStats = async (req, res) => {
  try {
    const [totals, revenue, byCategory, recentTickets, scanStats] = await Promise.all([
      pool.query(`SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status IN ('active','used','scanned')) as active,
        COUNT(*) FILTER (WHERE status IN ('used','scanned')) as scanned,
        COUNT(*) FILTER (WHERE status='pending') as pending
        FROM tickets`),
      pool.query(`SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE payment_status='success' OR payment_status='completed'`),
      pool.query(`SELECT tc.name, tc.color, COUNT(t.id) as count, tc.price, tc.available_quantity, tc.total_quantity
        FROM ticket_categories tc LEFT JOIN tickets t ON t.category_id=tc.id GROUP BY tc.id, tc.name, tc.color, tc.price, tc.available_quantity, tc.total_quantity ORDER BY tc.price ASC`),
      pool.query(`SELECT t.holder_name, t.status, t.created_at, tc.name as category, tc.color
        FROM tickets t LEFT JOIN ticket_categories tc ON tc.id=t.category_id
        ORDER BY t.created_at DESC LIMIT 8`),
      pool.query(`SELECT DATE(scanned_at) as date, COUNT(*) as count FROM scans WHERE result='VALID'
        AND scanned_at > NOW()-INTERVAL '7 days' GROUP BY DATE(scanned_at) ORDER BY date`),
    ]);

    res.json({
      stats: {
        ...totals.rows[0],
        revenue: parseFloat(revenue.rows[0].total),
        by_category: byCategory.rows,
        recent_tickets: recentTickets.rows,
        scan_stats: scanStats.rows,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { reserveTicket, checkPayment, myTickets, getTicket, downloadTicket, verifyTicket, getAdminStats };