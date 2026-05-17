const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/database');

/**
 * MTN Mobile Money API — Congo-Brazzaville (XAF)
 * Docs : https://momodeveloper.mtn.com
 * Env sandbox  : sandbox.momodeveloper.mtn.com
 * Env production: mtncongo (X-Target-Environment: mtncongo)
 *
 * ÉTAPES POUR OBTENIR VOS CLÉS :
 * 1. Créez un compte sur https://momodeveloper.mtn.com
 * 2. Souscrivez au produit "Collection"
 * 3. Récupérez votre Ocp-Apim-Subscription-Key (clé primaire)
 * 4. Créez un API User (voir createSandboxUser() ci-dessous)
 * 5. Créez un API Key pour cet API User
 * 6. Renseignez les variables dans votre .env
 */

const MTN_BASE_SANDBOX = 'https://sandbox.momodeveloper.mtn.com';
const MTN_BASE_PROD    = 'https://proxy.momoapi.mtn.com'; // production

const IS_SANDBOX = process.env.MTN_ENVIRONMENT === 'sandbox';
const BASE_URL   = IS_SANDBOX ? MTN_BASE_SANDBOX : MTN_BASE_PROD;
const TARGET_ENV = IS_SANDBOX ? 'sandbox' : 'mtncongo';

/** Génère un token d'accès Bearer */
async function getAccessToken() {
  const apiUser = process.env.MTN_API_USER;
  const apiKey  = process.env.MTN_API_KEY;
  const subKey  = process.env.MTN_SUBSCRIPTION_KEY;

  if (!apiUser || !apiKey || !subKey) {
    throw new Error('MTN MoMo: variables MTN_API_USER, MTN_API_KEY et MTN_SUBSCRIPTION_KEY manquantes dans .env');
  }

  const credentials = Buffer.from(`${apiUser}:${apiKey}`).toString('base64');

  const res = await axios.post(
    `${BASE_URL}/collection/token/`,
    {},
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Ocp-Apim-Subscription-Key': subKey,
      },
    }
  );

  return res.data.access_token;
}

/**
 * Initie un paiement RequestToPay MTN MoMo
 * Retourne le txRef (UUID) à utiliser pour vérifier le statut
 */
async function requestToPay({ ticketId, userId, amount, phone, holderName, eventTitle }) {
  const txRef = uuidv4(); // X-Reference-Id obligatoire, format UUID v4

  // Nettoyer le numéro : enlever +, espaces, et le 0 initial si présent
  // Format attendu par MTN : MSISDN international sans +
  // Ex: +242068072632 → 242068072632
  const cleanPhone = phone
    .replace(/\s/g, '')
    .replace(/^\+/, '')
    .replace(/^0/, '242'); // préfixe Congo si commence par 0

  // Enregistrer en base avec statut pending
  await pool.query(`
    INSERT INTO payments (ticket_id, user_id, amount, currency, method, transaction_id, payment_status, phone_number, metadata)
    VALUES ($1,$2,$3,'XAF','mtn',$4,'pending',$5,$6)
  `, [
    ticketId, userId, amount, txRef, cleanPhone,
    JSON.stringify({ provider: 'mtn_momo', environment: TARGET_ENV, phone_formatted: cleanPhone }),
  ]);

  // Mode simulation si clés absentes
  if (!process.env.MTN_SUBSCRIPTION_KEY || process.env.MTN_SUBSCRIPTION_KEY === 'YOUR_MTN_KEY') {
    console.log(`[MTN SIMULATION] ${txRef} — ${amount} XAF → ${cleanPhone}`);
    setTimeout(() => simulateSuccess(txRef), 5000);
    return { txRef, status: 'pending', mode: 'simulation', message: `Paiement simulé — activation dans 5 secondes` };
  }

  try {
    const token = await getAccessToken();

    await axios.post(
      `${BASE_URL}/collection/v1_0/requesttopay`,
      {
        amount: String(amount),
        currency: 'XAF',
        externalId: txRef,
        payer: {
          partyIdType: 'MSISDN',
          partyId: cleanPhone,
        },
        payerMessage: `Ticket - ${eventTitle}`.slice(0, 160),
        payeeNote:    `TicketFlow - ${holderName}`.slice(0, 160),
      },
      {
        headers: {
          Authorization:              `Bearer ${token}`,
          'X-Reference-Id':           txRef,
          'X-Target-Environment':     TARGET_ENV,
          'Ocp-Apim-Subscription-Key': process.env.MTN_SUBSCRIPTION_KEY,
          'Content-Type':             'application/json',
          // Webhook optionnel : décommentez si vous avez un serveur public
          // 'X-Callback-Url': `${process.env.BACKEND_URL}/api/webhooks/mtn`,
        },
      }
    );

    // 202 Accepted = requête créée, en attente de confirmation du payeur
    console.log(`✅ MTN MoMo requestToPay envoyé: ${txRef} → ${cleanPhone}`);
    return {
      txRef,
      status: 'pending',
      message: `Demande envoyée. Confirmez sur votre téléphone MTN MoMo (${phone})`,
    };
  } catch (err) {
    const msg = err.response?.data?.message || err.response?.data || err.message;
    console.error('MTN MoMo error:', msg);
    await pool.query(`UPDATE payments SET payment_status='failed' WHERE transaction_id=$1`, [txRef]);
    throw new Error(`Erreur MTN MoMo: ${JSON.stringify(msg)}`);
  }
}

/**
 * Vérifie le statut d'une transaction (polling)
 * GET /collection/v1_0/requesttopay/{referenceId}
 * Statuts possibles: PENDING, SUCCESSFUL, FAILED
 */
async function getPaymentStatus(txRef) {
  if (!process.env.MTN_SUBSCRIPTION_KEY || process.env.MTN_SUBSCRIPTION_KEY === 'YOUR_MTN_KEY') {
    const pay = await pool.query('SELECT * FROM payments WHERE transaction_id=$1', [txRef]);
    return pay.rows[0] || null;
  }

  try {
    const token = await getAccessToken();
    const res = await axios.get(
      `${BASE_URL}/collection/v1_0/requesttopay/${txRef}`,
      {
        headers: {
          Authorization:               `Bearer ${token}`,
          'X-Target-Environment':      TARGET_ENV,
          'Ocp-Apim-Subscription-Key': process.env.MTN_SUBSCRIPTION_KEY,
        },
      }
    );

    const { status, financialTransactionId } = res.data;

    if (status === 'SUCCESSFUL') {
      await activateTicket(txRef, financialTransactionId);
    } else if (status === 'FAILED') {
      await pool.query(`UPDATE payments SET payment_status='failed', updated_at=NOW() WHERE transaction_id=$1`, [txRef]);
    }
  } catch (err) {
    console.error('Erreur vérification MTN:', err.response?.data || err.message);
  }

  const pay = await pool.query('SELECT * FROM payments WHERE transaction_id=$1', [txRef]);
  return pay.rows[0] || null;
}

/** Active le ticket après paiement confirmé */
async function activateTicket(txRef, financialId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const payRes = await client.query(
      `SELECT * FROM payments WHERE transaction_id=$1 AND payment_status != 'success' FOR UPDATE`,
      [txRef]
    );
    if (!payRes.rows.length) { await client.query('ROLLBACK'); return; }

    const payment = payRes.rows[0];
    await client.query(
      `UPDATE payments SET payment_status='success', operator_ref=$1, updated_at=NOW() WHERE transaction_id=$2`,
      [financialId || 'MTN-' + txRef, txRef]
    );
    await client.query(
      `UPDATE tickets SET status='active', updated_at=NOW() WHERE id=$1 AND status='pending'`,
      [payment.ticket_id]
    );
    await client.query('COMMIT');
    console.log(`✅ Ticket #${payment.ticket_id} activé (MTN ${txRef})`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur activation:', err.message);
  } finally { client.release(); }
}

async function simulateSuccess(txRef) {
  await activateTicket(txRef, 'SIM-MTN-' + txRef.slice(0, 8));
}

/**
 * Webhook MTN MoMo (callback)
 * MTN envoie un POST sur X-Callback-Url quand le paiement est confirmé
 */
async function handleMtnWebhook(req, res) {
  try {
    const body = req.body;
    console.log('📲 MTN Webhook reçu:', JSON.stringify(body));

    const { referenceId, status, financialTransactionId } = body;

    if (status === 'SUCCESSFUL' && referenceId) {
      await activateTicket(referenceId, financialTransactionId);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook MTN error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * UTILITAIRE SANDBOX : créer un API User + API Key automatiquement
 * À appeler une seule fois pour obtenir MTN_API_USER et MTN_API_KEY
 * Usage : node -e "require('./src/services/mtnMomoService').createSandboxCredentials()"
 */
async function createSandboxCredentials() {
  const subKey = process.env.MTN_SUBSCRIPTION_KEY;
  if (!subKey) { console.error('MTN_SUBSCRIPTION_KEY manquant dans .env'); return; }

  const apiUserId = uuidv4();
  console.log('\n🔧 Création des credentials sandbox MTN MoMo...');

  try {
    // 1. Créer l'API User
    await axios.post(
      `${MTN_BASE_SANDBOX}/v1_0/apiuser`,
      { providerCallbackHost: process.env.BACKEND_URL || 'http://localhost:5000' },
      {
        headers: {
          'X-Reference-Id':           apiUserId,
          'Ocp-Apim-Subscription-Key': subKey,
          'Content-Type':             'application/json',
        },
      }
    );
    console.log(`✅ API User créé: ${apiUserId}`);

    // 2. Créer l'API Key
    const keyRes = await axios.post(
      `${MTN_BASE_SANDBOX}/v1_0/apiuser/${apiUserId}/apikey`,
      {},
      { headers: { 'Ocp-Apim-Subscription-Key': subKey } }
    );
    const apiKey = keyRes.data.apiKey;

    console.log('\n✅ Credentials créés ! Ajoutez dans votre .env :');
    console.log(`MTN_API_USER=${apiUserId}`);
    console.log(`MTN_API_KEY=${apiKey}`);
    console.log(`MTN_ENVIRONMENT=sandbox`);
  } catch (err) {
    console.error('Erreur:', err.response?.data || err.message);
  }
}

module.exports = { requestToPay, getPaymentStatus, handleMtnWebhook, createSandboxCredentials };
