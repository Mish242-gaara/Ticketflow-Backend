const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database'); // ✅ Import corrigé
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

  const client = await pool.connect(); // ✅ Utilisation correcte de pool.connect()
  try {
    await client.query('BEGIN');

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
    client.release(); // ✅ Libération du client
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

// POST /api/tickets/admin/validate-payment/:txRef
const validatePaymentManually = async (req, res) => {
  const { txRef } = req.params;
  const { action } = req.body;

  if (!action || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: "L'action est requise et doit être 'approve' ou 'reject'" });
  }

  const client = await pool.connect(); // ✅ Utilisation correcte de pool.connect()
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
    client.release(); // ✅ Libération du client
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