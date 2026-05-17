const { Pool } = require('pg');
require('dotenv').config();

let pool;

// Si DATABASE_URL est fournie (Production sur Render / URL Neon directe)
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Configuration SSL indispensable pour Neon en production
    ssl: {
      rejectUnauthorized: false
    }
  });
} else {
  // Mode de secours (Local) si tu utilises encore des variables séparées en local
  pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'ticket_platform',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
  });
}

pool.on('connect', () => {
  console.log('✅ Connecté avec succès à PostgreSQL (Neon/Local)');
});

pool.on('error', (err) => {
  console.error('❌ Erreur PostgreSQL inattendue sur le pool:', err.message);
  // En production, on évite de faire process.exit(-1) pour que le serveur Render 
  // ne crashe pas définitivement à la moindre micro-coupure réseau de la BDD.
  if (process.env.NODE_ENV !== 'production') {
    process.exit(-1);
  }
});

module.exports = pool;