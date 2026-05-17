const { pool } = require('../config/database');

async function migrateV2() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('🚀 Migration v2...');

    // Colonne google_id pour OAuth
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE;`);
    // Rendre password nullable (comptes Google n'ont pas de mot de passe)
    await client.query(`ALTER TABLE users ALTER COLUMN password DROP NOT NULL;`);
    // Avatar
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;`);
    // Provider: 'local' ou 'google'
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS provider VARCHAR(20) DEFAULT 'local';`);
    // updated_at sur ticket_categories (fix erreur précédente)
    await client.query(`ALTER TABLE ticket_categories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();`);
    // Notifications/annonces
    await client.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id          SERIAL PRIMARY KEY,
        title       VARCHAR(255) NOT NULL,
        message     TEXT NOT NULL,
        channel     VARCHAR(20) DEFAULT 'email',
        sent_by     INT REFERENCES users(id),
        sent_count  INT DEFAULT 0,
        created_at  TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query('COMMIT');
    console.log('✅ Migration v2 terminée !');
    console.log('   ✔ google_id, avatar_url, provider ajoutés à users');
    console.log('   ✔ password rendu nullable');
    console.log('   ✔ updated_at ajouté à ticket_categories');
    console.log('   ✔ table announcements créée');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur:', err.message);
  } finally {
    client.release();
    pool.end();
  }
}

migrateV2().catch(console.error);
