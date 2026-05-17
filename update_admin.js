require('dotenv').config();
const bcrypt = require('bcryptjs');
const database = require('./src/config/database'); // Ajuste le chemin vers ton fichier database.js si besoin
const pool = database.pool || database;

async function updateAdmin() {
  try {
    console.log("⏳ Hachage du mot de passe...");
    const hash = await bcrypt.hash('admin1234', 10);
    
    console.log("⏳ Connexion à la base de données...");
    const res = await pool.query(
      "UPDATE users SET password = $1, role = 'admin' WHERE email = 'admin@estam.cg' RETURNING *",
      [hash]
    );

    if (res.rowCount === 0) {
      console.log("❌ Aucun utilisateur trouvé avec l'email admin@estam.cg. Exécution d'un INSERT de secours...");
      await pool.query(
        "INSERT INTO users (fullname, email, password, role) VALUES ('Admin', 'admin@estam.cg', $1, 'admin')",
        [hash]
      );
      console.log("✅ Admin créé de toutes pièces avec succès !");
    } else {
      console.log("✅ Mot de passe de l'admin mis à jour avec succès dans la bonne base !");
    }
  } catch (err) {
    console.error("❌ Erreur lors de la mise à jour :", err.message);
  } finally {
    pool.end();
  }
}

updateAdmin();
