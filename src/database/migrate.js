const pool = require('../config/database');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🚀 Début des migrations...');

    await client.query('BEGIN');

    // ── USERS ──────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id          SERIAL PRIMARY KEY,
        fullname    VARCHAR(255) NOT NULL,
        email       VARCHAR(255) UNIQUE NOT NULL,
        phone       VARCHAR(30),
        password    TEXT NOT NULL,
        role        VARCHAR(20) DEFAULT 'user',
        avatar_url  TEXT,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table users');

    // ── EVENTS ─────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS events (
        id                 SERIAL PRIMARY KEY,
        title              VARCHAR(255) NOT NULL,
        slug               VARCHAR(255) UNIQUE,
        description        TEXT,
        long_description   TEXT,
        location           VARCHAR(255),
        date               TIMESTAMP NOT NULL,
        end_date           TIMESTAMP,
        banner_url         TEXT,
        organizer          VARCHAR(255),
        total_tickets      INT DEFAULT 0,
        available_tickets  INT DEFAULT 0,
        status             VARCHAR(20) DEFAULT 'active',
        created_by         INT REFERENCES users(id),
        created_at         TIMESTAMP DEFAULT NOW(),
        updated_at         TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table events');

    // ── TICKET CATEGORIES ──────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS ticket_categories (
        id                 SERIAL PRIMARY KEY,
        event_id           INT REFERENCES events(id) ON DELETE CASCADE,
        name               VARCHAR(100) NOT NULL,
        description        TEXT,
        price              DECIMAL(10,2) NOT NULL DEFAULT 0,
        total_quantity     INT NOT NULL DEFAULT 0,
        available_quantity INT NOT NULL DEFAULT 0,
        color              VARCHAR(20) DEFAULT '#3B82F6',
        created_at         TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table ticket_categories');

    // ── TICKETS ────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id           SERIAL PRIMARY KEY,
        ticket_uuid  VARCHAR(255) UNIQUE NOT NULL,
        user_id      INT REFERENCES users(id),
        event_id     INT REFERENCES events(id),
        category_id  INT REFERENCES ticket_categories(id),
        qr_code      TEXT,
        qr_token     TEXT,
        holder_name  VARCHAR(255),
        holder_phone VARCHAR(30),
        holder_email VARCHAR(255),
        status       VARCHAR(20) DEFAULT 'pending',
        scanned_at   TIMESTAMP,
        scanned_by   INT REFERENCES users(id),
        created_at   TIMESTAMP DEFAULT NOW(),
        updated_at   TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table tickets');

    // ── PAYMENTS ───────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id               SERIAL PRIMARY KEY,
        ticket_id        INT REFERENCES tickets(id),
        user_id          INT REFERENCES users(id),
        amount           DECIMAL(10,2) NOT NULL,
        currency         VARCHAR(10) DEFAULT 'XAF',
        method           VARCHAR(50),
        transaction_id   VARCHAR(255) UNIQUE,
        operator_ref     VARCHAR(255),
        payment_status   VARCHAR(20) DEFAULT 'pending',
        phone_number     VARCHAR(30),
        metadata         JSONB DEFAULT '{}',
        created_at       TIMESTAMP DEFAULT NOW(),
        updated_at       TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table payments');

    // ── SCANS ──────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS scans (
        id          SERIAL PRIMARY KEY,
        ticket_id   INT REFERENCES tickets(id),
        scanned_by  INT REFERENCES users(id),
        result      VARCHAR(20) NOT NULL,
        ip_address  VARCHAR(50),
        user_agent  TEXT,
        scanned_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✔ Table scans');

    // ── INDEX ──────────────────────────────────────────────────────────────
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tickets_uuid ON tickets(ticket_uuid);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tickets_event ON tickets(event_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_ticket ON payments(ticket_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_scans_ticket ON scans(ticket_id);`);

    await client.query('COMMIT');
    console.log('\n✅ Migrations terminées avec succès !');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur migration:', err.message);
    throw err;
  } finally {
    client.release();
    pool.end();
  }
}

migrate().catch(console.error);
