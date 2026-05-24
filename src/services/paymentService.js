/**
 * pawaPay Payment Service — Congo-Brazzaville (XAF)
 * Opérateurs supportés :
 * MTN MoMo   → MTN_MOMO_COG
 * Airtel     → AIRTEL_COG
 *
 * Doc : https://docs.pawapay.io
 * Sandbox : https://api.sandbox.pawapay.io
 * Production : https://api.pawapay.io
 */

const axios  = require('axios');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');

const IS_SANDBOX = process.env.PAWAPAY_ENV !== 'production';
const BASE_URL   = IS_SANDBOX
  ? 'https://api.sandbox.pawapay.io'
  : 'https://api.pawapay.io';

// Correspondance opérateur UI → code pawaPay Congo-Brazzaville
const OPERATOR_MAP = {
  mtn:    'MTN_MOMO_COG',
  airtel: 'AIRTEL_COG',
};

/**
 * Formate le numéro de téléphone au format international sans +
 * Adapté aux exigences de longueur de pawaPay COG
 */
function formatPhone(phone) {
  let p = phone.replace(/[\s\-().]/g, '').replace(/^\+/, '');
  if (p.startsWith('00')) p = p.slice(2);
  
  // Sécurité spécifique pour le numéro de test Sandbox standard "060000001"
  if (p === '060000001' || p === '60000001') {
    return '242060000001'; // Format complet à 12 caractères accepté en Sandbox
  }

  // Si commence par 0 sans indicatif pays → ajouter 242 (Congo)
  if (p.startsWith('0') && p.length <= 10) p = '242' + p.slice(1);
  // Si pas d'indicatif pays → ajouter 242
  if (!p.startsWith('242') && p.length <= 9) p = '242' + p;
  
  return p;
}

/**
 * Initie un dépôt (collect) via pawaPay
 * Retourne { depositId, status, message, mode }
 */
async function initiatePayment({ ticketId, userId, amount, phone, method, holderName, holderEmail, eventTitle }) {
  const depositId = uuidv4();  // ID unique de la transaction (pawaPay l'appelle depositId)
  const correspondent = OPERATOR_MAP[method] || 'MTN_MOMO_COG';
  const formattedPhone = formatPhone(phone);

  // Élimination stricte des décimales pour le XAF (Ex: 6000.00 -> 6000)
  const cleanAmount = String(Math.round(Number(amount)));

  // Enregistrer en base
  await pool.query(`
    INSERT INTO payments
      (ticket_id, user_id, amount, currency, method, transaction_id, payment_status, phone_number, metadata)
    VALUES ($1,$2,$3,'XAF',$4,$5,'pending',$6,$7)
  `, [
    ticketId, userId, amount, method, depositId, formattedPhone,
    JSON.stringify({ provider: 'pawapay', correspondent, env: IS_SANDBOX ? 'sandbox' : 'production' }),
  ]);

  // Mode simulation (pas de token configuré)
  const token = process.env.PAWAPAY_API_TOKEN;
  if (!token || token.startsWith('YOUR_')) {
    console.log(`[pawaPay SIMULATION] ${depositId} — ${cleanAmount} XAF → ${formattedPhone} (${correspondent})`);
    setTimeout(() => _activateTicket(depositId, 'SIM-' + depositId.slice(0, 8)), 5000);
    return {
      depositId,
      status:  'ACCEPTED',
      mode:    'simulation',
      message: `[DEV] Paiement simulé — activation automatique dans 5 secondes`,
    };
  }

  // Appel API pawaPay réel
  try {
    // 1. Nettoyage et formatage strict du timestamp pour pawaPay (AAAA-MM-JJTHH:MM:SSZ)
    const strictTimestamp = new Date().toISOString().split('.')[0] + 'Z';

    // 2. Sécurisation de la description (Chaîne fixe et propre sans caractères spéciaux)
    const cleanDescription = "TicketFlowBillet";

    const payload = {
      depositId,                             // UUID unique obligatoire
      amount:        cleanAmount,            // Plus de décimales ici
      currency:      'XAF',
      correspondent,                         // MTN_MOMO_COG ou AIRTEL_COG
      payer: {
        type:    'MSISDN',
        address: { value: formattedPhone },
      },
      customerTimestamp: strictTimestamp,
      statementDescription: cleanDescription
    };

    // Ajouter le callback si configuré (nécessite un serveur public / ngrok en dev)
    if (process.env.BACKEND_URL && !process.env.BACKEND_URL.includes('localhost')) {
      payload.returnUrl = `${process.env.BACKEND_URL}/api/webhooks/pawapay`;
    }

    const res = await axios.post(`${BASE_URL}/deposits`, payload, {
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    const data = res.data;
    console.log(`✅ pawaPay réponse reçue pour : ${depositId} — statut: ${data.status}`);

    // Si pawaPay répond 200 mais rejette la transaction
    if (data.status === 'REJECTED') {
      console.error('🔍 [pawaPay REJECTED - RÉPONSE BRUTE] :', JSON.stringify(data, null, 2));
      
      // Marquer le paiement en erreur localement
      await pool.query(
        `UPDATE payments SET payment_status='failed' WHERE transaction_id=$1`,
        [depositId]
      );
      
      const reason = data.rejectionReason?.rejectionMessage || data.rejectionReason?.message || 'Refusé par l\'opérateur';
      throw new Error(`Transaction rejetée par pawaPay : ${reason}`);
    }

    // Mettre à jour la ref opérateur si fournie (si ACCEPTED ou COMPLETED)
    if (data.depositId) {
      await pool.query(
        `UPDATE payments SET operator_ref=$1 WHERE transaction_id=$2`,
        [data.depositId, depositId]
      );
    }

    return {
      depositId,
      status:  data.status || 'ACCEPTED',
      message: `Demande envoyée. Confirmez sur votre téléphone ${method.toUpperCase()} (${phone})`,
    };
  } catch (err) {
    const errData = err.response?.data;
    const msg = errData?.errorMessage || errData?.message || err.message;
    
    console.error('❌ [pawaPay DÉTAILS ERREUR RÉSEAU / API] :', {
      status: err.response?.status,
      statusText: err.response?.statusText,
      errorResponse: errData ? JSON.stringify(errData, null, 2) : msg
    });

    // Éviter de doubler la mise à jour si déjà faite au-dessus
    await pool.query(
      `UPDATE payments SET payment_status='failed' WHERE transaction_id=$1`,
      [depositId]
    ).catch(() => {});

    throw new Error(`Erreur paiement pawaPay : ${msg}`);
  }
}

/**
 * Vérifie le statut d'un dépôt (polling frontend)
 * GET /deposits/{depositId}
 * Statuts pawaPay : ACCEPTED, COMPLETED, FAILED
 */
async function checkPaymentStatus(depositId) {
  const token = process.env.PAWAPAY_API_TOKEN;

  // En simulation ou sans token, lire directement la DB
  if (!token || token.startsWith('YOUR_')) {
    const res = await pool.query('SELECT * FROM payments WHERE transaction_id=$1', [depositId]);
    return res.rows[0] || null;
  }

  try {
    const res = await axios.get(`${BASE_URL}/deposits/${depositId}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    });

    const deposits = res.data; // pawaPay retourne un tableau
    const deposit  = Array.isArray(deposits) ? deposits[0] : deposits;

    if (deposit?.status === 'COMPLETED') {
      await _activateTicket(depositId, deposit.depositId || depositId);
    } else if (deposit?.status === 'FAILED' || deposit?.status === 'REJECTED') {
      await pool.query(
        `UPDATE payments SET payment_status='failed', updated_at=NOW() WHERE transaction_id=$1`,
        [depositId]
      );
    }
  } catch (err) {
    console.error('pawaPay verify error:', err.response?.data || err.message);
  }

  const pay = await pool.query('SELECT * FROM payments WHERE transaction_id=$1', [depositId]);
  return pay.rows[0] || null;
}

/**
 * Webhook pawaPay — appelé par pawaPay quand le paiement change de statut
 * POST /api/webhooks/pawapay
 */
async function handlePawaPayWebhook(req, res) {
  try {
    const body = req.body;
    console.log('📲 pawaPay Webhook:', JSON.stringify(body).slice(0, 200));

    // pawaPay envoie : { depositId, status, ... }
    const { depositId, status } = body;

    if (status === 'COMPLETED' && depositId) {
      await _activateTicket(depositId, depositId);
    } else if ((status === 'FAILED' || status === 'REJECTED') && depositId) {
      await pool.query(
        `UPDATE payments SET payment_status='failed', updated_at=NOW() WHERE transaction_id=$1`,
        [depositId]
      );
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * Active le ticket après confirmation du paiement
 */
async function _activateTicket(depositId, operatorRef) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const payRes = await client.query(
      `SELECT * FROM payments WHERE transaction_id=$1 AND payment_status != 'success' FOR UPDATE`,
      [depositId]
    );
    if (!payRes.rows.length) { await client.query('ROLLBACK'); return; }

    const payment = payRes.rows[0];

    await client.query(
      `UPDATE payments SET payment_status='success', operator_ref=$1, updated_at=NOW() WHERE transaction_id=$2`,
      [operatorRef || depositId, depositId]
    );
    await client.query(
      `UPDATE tickets SET status='active', updated_at=NOW() WHERE id=$1 AND status='pending'`,
      [payment.ticket_id]
    );

    await client.query('COMMIT');
    console.log(`✅ Ticket #${payment.ticket_id} activé (pawaPay ${depositId})`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Activation error:', err.message);
  } finally {
    client.release();
  }
}

module.exports = {
  initiatePayment,
  checkPaymentStatus,
  handlePawaPayWebhook,
  _activateTicket // Exporté pour l'appel de validation manuelle administrateur
};