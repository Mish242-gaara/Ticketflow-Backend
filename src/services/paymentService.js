const axios = require('axios');
const crypto = require('crypto');
const { pool } = require('../config/database');

const FLW_BASE = 'https://api.flutterwave.com/v3';
const FLW_SECRET = process.env.FLW_SECRET_KEY;

/**
 * Initie un paiement Mobile Money via Flutterwave
 * Congo-Brazzaville (XAF): MTN Money + Airtel Money
 */
async function initiateFlutterwavePayment({ ticketId, userId, amount, phone, method, holderName, holderEmail, eventTitle }) {
  const txRef = `TKF-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const networkMap = { mtn: 'MTN', airtel: 'AIRTEL' };
  const network = networkMap[method] || 'MTN';

  await pool.query(`
    INSERT INTO payments (ticket_id, user_id, amount, currency, method, transaction_id, payment_status, phone_number, metadata)
    VALUES ($1,$2,$3,'XAF',$4,$5,'pending',$6,$7)
  `, [ticketId, userId, amount, method, txRef, phone, JSON.stringify({ provider: 'flutterwave', network })]);

  // Mode simulation si pas de vraie clé
  const isDemo = !FLW_SECRET || FLW_SECRET.includes('DEMO') || FLW_SECRET.includes('YOUR_');
  if (isDemo) {
    console.log(`[DEV SIMULATION] Paiement ${txRef} — ${amount} XAF via ${network}`);
    setTimeout(() => simulateSuccess(txRef), 4000);
    return { txRef, status: 'pending', mode: 'simulation', message: `Paiement simulé. Activation dans 4 secondes.` };
  }

  // Appel Flutterwave réel
  try {
    const cleanPhone = phone.replace(/\s/g, '').replace(/^\+/, '');
    const payload = {
      tx_ref: txRef,
      amount: String(amount),
      currency: 'XAF',
      network,
      email: holderEmail || `${cleanPhone}@ticketflow.cg`,
      phone_number: cleanPhone,
      fullname: holderName,
      narration: `Ticket - ${eventTitle}`,
    };

    const res = await axios.post(`${FLW_BASE}/charges?type=mobile_money_franco`, payload, {
      headers: { Authorization: `Bearer ${FLW_SECRET}`, 'Content-Type': 'application/json' },
    });

    const flwData = res.data?.data;
    if (flwData?.flw_ref) {
      await pool.query(`UPDATE payments SET operator_ref=$1 WHERE transaction_id=$2`, [flwData.flw_ref, txRef]);
    }

    return { txRef, flwRef: flwData?.flw_ref, status: 'pending', message: `Confirmez sur votre téléphone ${phone}` };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    await pool.query(`UPDATE payments SET payment_status='failed' WHERE transaction_id=$1`, [txRef]);
    throw new Error(`Erreur paiement Flutterwave: ${msg}`);
  }
}

/** Webhook Flutterwave */
async function handleFlutterwaveWebhook(req, res) {
  const hash = req.headers['verif-hash'];
  if (!hash || hash !== process.env.FLW_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Signature invalide' });
  }
  const { event, data } = req.body;
  if (event === 'charge.completed' && data?.status === 'successful') {
    await validateAndActivateTicket(data.tx_ref, data);
  }
  res.status(200).json({ received: true });
}

/** Vérification paiement (polling) */
async function checkPaymentStatus(txRef) {
  const isDemo = !FLW_SECRET || FLW_SECRET.includes('DEMO') || FLW_SECRET.includes('YOUR_');
  if (!isDemo) {
    try {
      const res = await axios.get(`${FLW_BASE}/transactions/verify_by_reference?tx_ref=${txRef}`, {
        headers: { Authorization: `Bearer ${FLW_SECRET}` },
      });
      const data = res.data?.data;
      if (data?.status === 'successful') await validateAndActivateTicket(txRef, data);
    } catch (err) { console.error('Verify error:', err.message); }
  }
  const pay = await pool.query('SELECT * FROM payments WHERE transaction_id=$1', [txRef]);
  return pay.rows[0] || null;
}

/** Activer ticket après paiement */
async function validateAndActivateTicket(txRef, flwData) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const payRes = await client.query(
      `SELECT * FROM payments WHERE transaction_id=$1 AND payment_status != 'success' FOR UPDATE`, [txRef]
    );
    if (!payRes.rows.length) { await client.query('ROLLBACK'); return; }
    const payment = payRes.rows[0];
    await client.query(`UPDATE payments SET payment_status='success', updated_at=NOW() WHERE transaction_id=$1`, [txRef]);
    await client.query(`UPDATE tickets SET status='active', updated_at=NOW() WHERE id=$1 AND status='pending'`, [payment.ticket_id]);
    await client.query('COMMIT');
    console.log(`✅ Ticket #${payment.ticket_id} activé (${txRef})`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Activation error:', err.message);
  } finally { client.release(); }
}

async function simulateSuccess(txRef) {
  await validateAndActivateTicket(txRef, { flw_ref: 'SIM-' + txRef });
}

module.exports = { initiateFlutterwavePayment, handleFlutterwaveWebhook, checkPaymentStatus };
