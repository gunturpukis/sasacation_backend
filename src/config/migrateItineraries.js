// src/config/migrateItineraries.js
// Migrasi A5 (audit Figma: bottom nav "Itinerary" + "View Itinerary" di
// My Trips + "Add to Itinerary" di trip planner).
//
// Sebelumnya trip-plan AI hanya generate sekali lalu hilang — tidak bisa
// dibuka lagi dari Itinerary. Sekarang hasilnya bisa disimpan + diedit:
//
//   - itineraries (rencana per trip milik user)
//   - itinerary_items (aktivitas per hari, urutan via position)
//
// Jalankan: npm run db:migrate:itineraries
// Aman dijalankan berkali-kali (idempotent).

require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔧 Menjalankan migrasi Itineraries (A5)...\n');
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS itineraries (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title      TEXT NOT NULL,
        destination TEXT,
        start_date DATE,
        end_date   DATE,
        status     TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','active','completed','cancelled')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel itineraries');

    await client.query(`
      CREATE TABLE IF NOT EXISTS itinerary_items (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        itinerary_id UUID NOT NULL REFERENCES itineraries(id) ON DELETE CASCADE,
        day          INT  NOT NULL DEFAULT 1 CHECK (day >= 1),
        time         TEXT,
        title        TEXT NOT NULL,
        description  TEXT,
        location     TEXT,
        kind         TEXT NOT NULL DEFAULT 'activity'
                     CHECK (kind IN ('activity','meal','rest','transport','stay')),
        position     INT  NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel itinerary_items');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_itineraries_user ON itineraries(user_id, created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_itinerary_items_parent
        ON itinerary_items(itinerary_id, day, position)
    `);
    console.log('✅ Index itineraries');

    await client.query('COMMIT');
    console.log('\n🎉 Migrasi itineraries selesai.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migrasi gagal:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
