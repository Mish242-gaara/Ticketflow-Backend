const pool = require('../config/database');
const bcrypt = require('bcryptjs');

async function seed() {
  const client = await pool.connect();
  try {
    console.log('🌱 Seeding de la base de données...');
    await client.query('BEGIN');

    // Admin user
    const hashedPwd = await bcrypt.hash('admin1234', 10);
    const adminRes = await client.query(`
      INSERT INTO users (fullname, email, phone, password, role)
      VALUES ('Admin BDE ESTAM', 'admin@estam.cg', '+242068072632', $1, 'admin')
      ON CONFLICT (email) DO NOTHING RETURNING id;
    `, [hashedPwd]);
    console.log('  ✔ Admin créé: admin@estam.cg / admin1234');

    const adminId = adminRes.rows[0]?.id || 1;

    // Sample event
    const eventRes = await client.query(`
      INSERT INTO events (
        title, slug, description, long_description, location, 
        date, end_date, organizer, total_tickets, available_tickets, 
        status, created_by
      )
      VALUES (
        'Marche Sportive — Journée Intégration',
        'marche-sportive-2026',
        'Journée exceptionnelle placée sous le signe du sport, de la cohésion et de la bonne ambiance !',
        'Le BDE ESTAM vous donne rendez-vous pour une journée exceptionnelle. Au programme : marche sportive du CTECH à la plage, animations, cohésion entre étudiants ESTAM et C-TECH.',
        'Du CTECH à la Plage, Pointe-Noire',
        '2026-04-25 07:00:00',
        '2026-04-25 18:00:00',
        'BDE ESTAM',
        400, 400,
        'active',
        $1
      )
      ON CONFLICT (slug) DO NOTHING RETURNING id;
    `, [adminId]);

    if (eventRes.rows.length > 0) {
      const eventId = eventRes.rows[0].id;

      // Ticket categories
      await client.query(`
        INSERT INTO ticket_categories (event_id, name, description, price, total_quantity, available_quantity, color)
        VALUES
          ($1, 'Étudiant ESTAM', 'Accès gratuit pour les étudiants ESTAM — inscription via délégué obligatoire', 0, 300, 300, '#3B82F6'),
          ($1, 'Apprenant C-TECH', 'Centre de formation partenaire — accès à 1000 FCFA', 1000, 80, 80, '#10B981'),
          ($1, 'Invité / Externe', 'Ouvert à tous — amis, famille, etc.', 1000, 20, 20, '#EF4444');
      `, [eventId]);

      console.log('  ✔ Événement et catégories créés');
    }

    await client.query('COMMIT');
    console.log('\n✅ Seed terminé !');
    console.log('\n🔑 Connexion admin:');
    console.log('   Email   : admin@estam.cg');
    console.log('   Mot de passe: admin1234');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur seed:', err.message);
  } finally {
    client.release();
    pool.end();
  }
}

seed().catch(console.error);
