const QRCode = require('qrcode');
const crypto = require('crypto');
require('dotenv').config();

const QR_SECRET = process.env.QR_SECRET || 'qr_secret_key';

/**
 * Génère un token signé pour un ticket
 */
function generateQRToken(ticketUuid) {
  const payload = `${ticketUuid}:${Date.now()}`;
  const hmac = crypto.createHmac('sha256', QR_SECRET);
  hmac.update(payload);
  const signature = hmac.digest('hex');
  return Buffer.from(`${payload}:${signature}`).toString('base64');
}

/**
 * Vérifie qu'un token QR est authentique
 */
function verifyQRToken(token, ticketUuid) {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length < 3) return false;

    const [uuid, , signature] = parts;
    if (uuid !== ticketUuid) return false;

    const payload = `${uuid}:${parts[1]}`;
    const hmac = crypto.createHmac('sha256', QR_SECRET);
    hmac.update(payload);
    const expected = hmac.digest('hex');

    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Génère une image QR code en base64
 */
async function generateQRImage(data) {
  return await QRCode.toDataURL(data, {
    errorCorrectionLevel: 'H',
    type: 'image/png',
    quality: 0.95,
    margin: 1,
    color: { dark: '#0D1B2E', light: '#FFFFFF' },
    width: 300,
  });
}

/**
 * Génère le QR code complet pour un ticket
 */
async function createTicketQR(ticketUuid) {
  const token = generateQRToken(ticketUuid);
  const qrData = JSON.stringify({ uuid: ticketUuid, token });
  const qrImage = await generateQRImage(qrData);
  return { token, qrImage, qrData };
}

module.exports = { generateQRToken, verifyQRToken, generateQRImage, createTicketQR };
