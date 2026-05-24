const { pool } = require('../config/database');

async function migrateV3() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('🚀 Migration v3 — paiement manuel...');

    // Ajouter colonne rejected dans payments
    await client.query(`
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP;
    `);
    // Ajouter statut rejected dans tickets (via contrainte check si existante)
    await client.query(`
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
    `);

    await client.query('COMMIT');
    console.log('✅ Migration v3 terminée !');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌', err.message);
  } finally {
    client.release();
    pool.end();
  }
}
migrateV3().catch(console.error);
