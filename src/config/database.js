const { Pool } = require('pg');

// ✅ Charge les variables d'environnement (pour le développement local)
require('dotenv').config();

// ✅ Configuration du Pool PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // ✅ Configuration SSL pour Neon (obligatoire en production)
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: false, // ✅ Nécessaire pour Neon (certificats auto-signés)
  } : false, // ✅ Désactive SSL en local si pas de certificat valide
  // ✅ Options supplémentaires pour éviter les warnings
  connectionInitSql: "SET time_zone = 'UTC';",
  // ✅ Timeout pour éviter les connexions bloquées
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

// ✅ Gestion des événements de connexion
pool.on('connect', () => {
  console.log('✅ Connecté avec succès à PostgreSQL (Neon/Local)');
});

pool.on('error', (err) => {
  console.error('❌ Erreur PostgreSQL inattendue:', err.message);
  // ✅ En production (Render), on ne crash pas le serveur pour une erreur de connexion
  if (process.env.NODE_ENV !== 'production') {
    process.exit(-1);
  }
});

// ✅ Teste la connexion au démarrage (optionnel mais utile pour déboguer)
async function testDatabaseConnection() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT 1');
    client.release();
    console.log('✅ Test de connexion PostgreSQL réussi:', result.rows[0]);
  } catch (err) {
    console.error('❌ Test de connexion PostgreSQL échoué:', err.message);
    // ✅ En production, on ne crash pas, mais on log l'erreur
    if (process.env.NODE_ENV !== 'production') {
      process.exit(-1);
    }
  }
}

// ✅ Appelle le test si NODE_ENV est développement (pour déboguer localement)
if (process.env.NODE_ENV === 'development') {
  testDatabaseConnection();
}

// ✅ Exporte le pool ET une méthode query pour la rétrocompatibilité
module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
};