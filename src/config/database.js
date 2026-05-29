const { Pool } = require('pg');
require('dotenv').config();

// ✅ Crée une seule instance de Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: false, // ✅ Nécessaire pour Neon
  } : false,
  connectionInitSql: "SET time_zone = 'UTC';",
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

// ✅ Logs de connexion
pool.on('connect', () => {
  console.log('✅ Connecté avec succès à PostgreSQL (Neon/Local)');
});

pool.on('error', (err) => {
  console.error('❌ Erreur PostgreSQL inattendue:', err.message);
  if (process.env.NODE_ENV !== 'production') {
    process.exit(-1);
  }
});

// ✅ Teste la connexion au démarrage
async function testDatabaseConnection() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT 1');
    client.release();
    console.log('✅ Test de connexion PostgreSQL réussi:', result.rows[0]);
  } catch (err) {
    console.error('❌ Test de connexion PostgreSQL échoué:', err.message);
    if (process.env.NODE_ENV !== 'production') {
      process.exit(-1);
    }
  }
}

if (process.env.NODE_ENV === 'development') {
  testDatabaseConnection();
}

// ✅ Exporte UNIQUEMENT pool
module.exports = pool;