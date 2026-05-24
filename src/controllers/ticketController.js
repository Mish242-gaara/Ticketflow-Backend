const { v4: uuidv4 } = require('uuid');
const database = require('../config/database');
const pool = database.pool || database;
const { createTicketQR, verifyQRToken } = require('../services/qrService');
const { generateTicketPDF } = require('../services/pdfService');
const { initiatePayment, checkPaymentStatus, _activateTicket } = require('../services/paymentService');

// POST /api/tickets/reserve
const reserveTicket = async (req, res) => {
  const { event_id, category_id, holder_name, holder_phone, holder_email, payment_method } = req.body;
  
  if (!event_id || !category_id || !holder_name || !holder_phone) {
    return res.status(400).json({
      error: 'event_id, category_id, holder_name et holder_phone sont requis'
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Vérifier la catégorie et verrouiller pour éviter les réservations simultanées
    const catRes = await client.query(
      `SELECT tc.*, e.title AS event_title
       FROM ticket_categories tc
       JOIN events e ON e.id = tc.event_id
       WHERE tc.id = $1 AND tc.event_id = $2
       FOR UPDATE`,
      [category_id, event_id]
    );

    if (!catRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Catégorie introuvable' });
    }

    const cat = catRes.rows[0];

    if (cat.available_quantity <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Plus de places disponibles dans cette catégorie'
      });
    }

    // Créer le ticket
    const ticketUuid = uuidv4();
    const { token, qrImage } = await createTicketQR(ticketUuid);
    const isFree = parseFloat(cat.price) === 0;

    const tickRes = await client.query(
      `INSERT INTO tickets
       (ticket_uuid, user_id, event_id, category_id, qr_code, qr_token, holder_name, holder_phone, holder_email, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        ticketUuid,
        req.user?.id || null,
        event_id,
        category_id,
        qrImage,
        token,
        holder_name,
        holder_phone,
        holder_email || null,
        isFree ? 'active' : 'pending'
      ]
    );

    const ticket = tickRes.rows[0];

    // Mettre à jour les quantités disponibles
    await client.query(
      `UPDATE ticket_categories SET available_quantity = available_quantity - 1 WHERE id = $1`,
      [category_id]
    );

    await client.query(
      `UPDATE events SET available_tickets = available_tickets - 1 WHERE id = $1`,
      [event_id]
    );

    await client.query('COMMIT');

    if (isFree) {
      return res.status(201).json({
        ticket,
        category: cat,
        payment_required: false,
        message: 'Ticket réservé avec succès !'
      });
    }

    // Initier le paiement avec PawaPay
    const payment = await initiatePayment({
      ticketId: ticket.id,
      userId: req.user?.id || null,
      amount: cat.price,
      phone: holder_phone,
      method: payment_method || 'mtn',
      holderName: holder_name,
      holderEmail: holder_email || '',
      eventTitle: cat.event_title,
    });

    return res.status(201).json({
      ticket,
      category: cat,
      payment_required: true,
      payment,
      message: 'Ticket réservé. Confirmez le paiement Mobile Money.'
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur réservation ticket:', err);
    return res.status(500).json({
      error: 'Erreur serveur lors de la réservation',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  } finally {
    client.release();
  }
};

// GET /api/tickets/check-payment/:txRef
const checkPayment = async (req, res) => {
  try {
    const payment = await checkPaymentStatus(req.params.txRef);

    if (!payment) {
      return res.status(404).json({ error: 'Transaction introuvable' });
    }

    let ticket = null;

    if (payment.payment_status === 'success') {
      const t = await pool.query(
        `SELECT t.*, tc.name AS category_name, tc.price, tc.color
         FROM tickets t
         LEFT JOIN ticket_categories tc ON tc.id = t.category_id
         WHERE t.id = $1`,
         [payment.ticket_id]
      );

      ticket = t.rows[0] || null;
    }

    return res.json({ payment, ticket });

  } catch (err) {
    console.error('Erreur vérification paiement:', err);
    return res.status(500).json({
      error: 'Erreur serveur lors de la vérification du paiement'
    });
  }
};

// GET /api/tickets/my
const myTickets = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, e.title AS event_title, e.date AS event_date, e.location AS event_location, 
              e.banner_url, tc.name AS category_name, tc.price, tc.color, 
              p.payment_status, p.method AS payment_method, p.transaction_id 
       FROM tickets t 
       LEFT JOIN events e ON e.id = t.event_id 
       LEFT JOIN ticket_categories tc ON tc.id = t.category_id 
       LEFT JOIN payments p ON p.ticket_id = t.id 
       WHERE t.user_id = $1 
       ORDER BY t.created_at DESC`,
      [req.user.id]
    );

    return res.json({ tickets: result.rows });

  } catch (err) {
    console.error('Erreur récupération tickets:', err);
    return res.status(500).json({
      error: 'Erreur serveur lors de la récupération des tickets'
    });
  }
};

// GET /api/tickets/:uuid
const getTicket = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, e.title AS event_title, e.date AS event_date, e.location AS event_location, 
              e.organizer, tc.name AS category_name, tc.price, tc.color, tc.description AS category_description 
       FROM tickets t 
       LEFT JOIN events e ON e.id = t.event_id 
       LEFT JOIN ticket_categories tc ON tc.id = t.category_id 
       WHERE t.ticket_uuid = $1`,
      [req.params.uuid]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Ticket introuvable' });
    }

    return res.json({ ticket: result.rows[0] });

  } catch (err) {
    console.error('Erreur récupération ticket:', err);
    return res.status(500).json({
      error: 'Erreur serveur lors de la récupération du ticket'
    });
  }
};

// GET /api/tickets/:uuid/download
const downloadTicket = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, e.title AS event_title, e.date, e.location, e.organizer, 
              tc.name AS category_name, tc.price, tc.color 
       FROM tickets t 
       LEFT JOIN events e ON e.id = t.event_id 
       LEFT JOIN ticket_categories tc ON tc.id = t.category_id 
       WHERE t.ticket_uuid = $1`,
      [req.params.uuid]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Ticket introuvable' });
    }

    const ticket = result.rows[0];
    const event = {
      title: ticket.event_title,
      date: ticket.date,
      location: ticket.location,
      organizer: ticket.organizer
    };
    const category = {
      name: ticket.category_name,
      price: ticket.price,
      color: ticket.color
    };

    const pdfBuffer = await generateTicketPDF(ticket, event, category);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="ticket-${ticket.ticket_uuid.slice(0, 8)}.pdf"`
    );

    return res.send(pdfBuffer);

  } catch (err) {
    console.error('Erreur génération PDF:', err);
    return res.status(500).json({
      error: 'Erreur serveur lors de la génération du PDF'
    });
  }
};

// POST /api/verify-ticket (admin scanner only)
const verifyTicket = async (req, res) => {
  const { qr_data } = req.body;
  if (!qr_data) {
    return res.status(400).json({ error: 'qr_data est requis' });
  }
  const client = await pool.connect();
  try {
    let parsed;

    try {
      parsed = JSON.parse(qr_data);
    } catch {
      return res.json({
        result: 'INVALID',
        message: '⛔ QR code invalide'
      });
    }

    const { uuid, token } = parsed;

    if (!uuid || !token) {
      return res.json({
        result: 'INVALID',
        message: '⛔ QR code malformé'
      });
    }

    // Vérifier l'authenticité du QR code
    if (!verifyQRToken(token, uuid)) {
      await pool.query(
        `INSERT INTO scans (ticket_id, scanned_by, result, ip_address)
         SELECT id, $1, 'INVALID', $2
         FROM tickets
         WHERE ticket_uuid = $3`,
        [req.user.id, req.ip, uuid]
      );

      return res.json({
        result: 'INVALID',
        message: '⛔ QR code non authentique'
      });
    }

    await client.query('BEGIN');

    // Étape 1: Verrouiller UNIQUEMENT la ligne du ticket (sans LEFT JOIN)
    const ticketRes = await client.query(
      `SELECT id, status, ticket_uuid, holder_name, holder_phone, event_id, category_id, scanned_at
       FROM tickets
       WHERE ticket_uuid = $1
       FOR UPDATE`,
      [uuid]
    );

    if (!ticketRes.rows.length) {
      await client.query('ROLLBACK');
      return res.json({
        result: 'INVALID',
        message: '⛔ Ticket introuvable en base'
      });
    }

    const ticket = ticketRes.rows[0];

    // Étape 2: Récupérer les détails (sans verrouillage)
    const detailsRes = await client.query(
      `SELECT e.title AS event_title, tc.name AS category_name, tc.color
       FROM events e, ticket_categories tc
       WHERE e.id = $1 AND tc.id = $2`,
      [ticket.event_id, ticket.category_id]
    );

    const details = detailsRes.rows[0] || {};

    // Vérifier si le ticket est déjà utilisé ou scanné
    if (ticket.status === 'used' || ticket.status === 'scanned') {
      await client.query('ROLLBACK');

      await pool.query(
        `INSERT INTO scans (ticket_id, scanned_by, result, ip_address)
         VALUES ($1, $2, 'USED', $3)`,
        [ticket.id, req.user.id, req.ip]
      );

      return res.json({
        result: 'USED',
        message: '🔴 Ticket déjà utilisé',
        ticket: {
          holder_name: ticket.holder_name,
          scanned_at: ticket.scanned_at,
          category_name: details.category_name,
          event_title: details.event_title
        }
      });
    }

    // Vérifier si le ticket est actif
    if (ticket.status !== 'active') {
      await client.query('ROLLBACK');
      return res.json({
        result: 'INVALID',
        message: `⛔ Ticket non valide (statut: ${ticket.status})`
      });
    }

    // Mettre à jour le statut du ticket en 'scanned'
    await client.query(
      `UPDATE tickets
       SET status = 'scanned', scanned_at = NOW(), scanned_by = $1, updated_at = NOW()
       WHERE id = $2`,
      [req.user.id, ticket.id]
    );

    // Enregistrer le scan
    await client.query(
      `INSERT INTO scans (ticket_id, scanned_by, result, ip_address)
       VALUES ($1, $2, 'VALID', $3)`,
      [ticket.id, req.user.id, req.ip]
    );

    await client.query('COMMIT');

    return res.json({
      result: 'VALID',
      message: '✅ Ticket valide — Entrée autorisée',
      ticket: {
        holder_name: ticket.holder_name,
        holder_phone: ticket.holder_phone,
        category_name: details.category_name,
        color: details.color,
        event_title: details.event_title
      }
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur vérification ticket:', err);
    return res.status(500).json({
      error: 'Erreur serveur lors de la vérification du ticket',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  } finally {
    client.release();
  }
};

// GET /api/admin/stats
const getAdminStats = async (req, res) => {
  try {
    const [totals, revenue, byCategory, recentTickets, scanStats] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS total, 
                COUNT(*) FILTER (WHERE status IN ('active', 'used', 'scanned')) AS active, 
                COUNT(*) FILTER (WHERE status IN ('used', 'scanned')) AS scanned, 
                COUNT(*) FILTER (WHERE status = 'pending') AS pending 
         FROM tickets`
      ),
      pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS total 
         FROM payments 
         WHERE payment_status = 'success' OR payment_status = 'completed'`
      ),
      pool.query(
        `SELECT tc.name, 
                tc.color, 
                COUNT(t.id) AS count, 
                tc.price, 
                tc.available_quantity, 
                tc.total_quantity 
         FROM ticket_categories tc 
         LEFT JOIN tickets t ON t.category_id = tc.id 
         GROUP BY tc.id, tc.name, tc.color, tc.price, tc.available_quantity, tc.total_quantity 
         ORDER BY tc.price ASC`
      ),
      pool.query(
        `SELECT t.holder_name, 
                t.status, 
                t.created_at, 
                tc.name AS category, 
                tc.color 
         FROM tickets t 
         LEFT JOIN ticket_categories tc ON tc.id = t.category_id 
         ORDER BY t.created_at DESC 
         LIMIT 8`
      ),
      pool.query(
        `SELECT DATE(scanned_at) AS date, 
                COUNT(*) AS count 
         FROM scans 
         WHERE result = 'VALID' 
           AND scanned_at > NOW() - INTERVAL '7 days' 
         GROUP BY DATE(scanned_at) 
         ORDER BY date`
      )
    ]);

    return res.json({
      stats: {
        ...totals.rows[0],
        revenue: parseFloat(revenue.rows[0].total),
        by_category: byCategory.rows,
        recent_tickets: recentTickets.rows,
        scan_stats: scanStats.rows
      }
    });

  } catch (err) {
    console.error('Erreur récupération stats:', err);
    return res.status(500).json({
      error: 'Erreur serveur lors de la récupération des statistiques'
    });
  }
};

// GET /api/admin/tickets/pending
// Dans ticketController.js
const getPendingTickets = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.id AS ticket_id, t.ticket_uuid, t.holder_name, t.holder_phone, 
              t.status AS ticket_status, e.title AS event_title, 
              COALESCE(p.payment_status, 'non_initie') AS payment_status, 
              p.transaction_id AS tx_ref, p.amount, tc.name AS category_name
       FROM tickets t 
       LEFT JOIN events e ON e.id = t.event_id 
       LEFT JOIN ticket_categories tc ON tc.id = t.category_id 
       LEFT JOIN payments p ON p.ticket_id = t.id 
       WHERE t.status = 'pending'
       ORDER BY t.created_at DESC`
    );
    return res.json({ tickets: result.rows });
  } catch (err) {
    console.error('Erreur getPendingTickets:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// POST /api/tickets/admin/validate-payment/:txRef
const validatePaymentManually = async (req, res) => {
  const { txRef } = req.params;
  const { action } = req.body;

  if (!action || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: "L'action est requise et doit être 'approve' ou 'reject'" });
  }

  const client = await pool.connect();
  try {
    if (action === 'approve') {
      await _activateTicket(txRef, 'MANUAL_APPROVAL');
      return res.json({
        success: true,
        message: '✅ Paiement validé manuellement. Le ticket est désormais actif.'
      });
    }

    if (action === 'reject') {
      await client.query('BEGIN');

      const payRes = await client.query(
        `SELECT ticket_id, payment_status FROM payments WHERE transaction_id = $1 FOR UPDATE`,
        [txRef]
      );

      if (!payRes.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Transaction introuvable' });
      }

      const payment = payRes.rows[0];

      if (payment.payment_status === 'success') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Impossible de rejeter un paiement déjà validé' });
      }

      await client.query(
        `UPDATE payments SET payment_status = 'failed', updated_at = NOW() WHERE transaction_id = $1`,
        [txRef]
      );

      await client.query(
        `UPDATE tickets SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
        [payment.ticket_id]
      );

      const tickRes = await client.query(
        `SELECT category_id, event_id FROM tickets WHERE id = $1`, 
        [payment.ticket_id]
      );
      
      if (tickRes.rows.length) {
        const { category_id, event_id } = tickRes.rows[0];
        
        await client.query(
          `UPDATE ticket_categories SET available_quantity = available_quantity + 1 WHERE id = $1`,
          [category_id]
        );
        await client.query(
          `UPDATE events SET available_tickets = available_tickets + 1 WHERE id = $1`,
          [event_id]
        );
      }

      await client.query('COMMIT');

      return res.json({
        success: true,
        message: '❌ Paiement rejeté. Le ticket a été annulé et la place a été libérée.'
      });
    }

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur validation manuelle du paiement:', err);
    return res.status(500).json({
      error: 'Erreur serveur lors de la validation du paiement',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  } finally {
    client.release();
  }
};

module.exports = {
  reserveTicket,
  checkPayment,
  myTickets,
  getTicket,
  downloadTicket,
  verifyTicket,
  getAdminStats,
  getPendingTickets,
  validatePaymentManually
};