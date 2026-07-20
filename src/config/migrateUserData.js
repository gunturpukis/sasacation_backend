// src/config/migrateUserData.js
// Jalankan sekali: node src/config/migrateUserData.js
// Menambahkan fondasi data untuk personalisasi AI:
//   - wishlist       → sinkron server-side (sebelumnya cuma SharedPreferences lokal)
//   - user_preferences → profil preferensi user (budget, minat, dislikes, dll)
//
// Ini adalah PRASYARAT untuk Travel Memory & Recommendation Engine.
// Tanpa tabel ini, AI tidak pernah tahu apa-apa tentang user selain namanya.

require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔧 Menambahkan tabel fondasi personalisasi AI...\n');
    await client.query('BEGIN');

    // ── Wishlist (server-side, gantikan SharedPreferences lokal) ────────────
    // unique (user_id, hotel_id) supaya toggle idempotent dari sisi app
    await client.query(`
      CREATE TABLE IF NOT EXISTS wishlist (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        hotel_id   UUID        NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, hotel_id)
      )
    `);
    console.log('✅ Tabel wishlist');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_wishlist_user ON wishlist(user_id)
    `);

    // ── User preferences ──────────────────────────────────────────────────
    // Desain sengaja dibuat "semi-terstruktur": kolom eksplisit untuk field
    // yang paling sering dipakai filter/rekomendasi (budget, group_type),
    // + JSONB `interests`/`raw_signals` untuk fleksibilitas tanpa migrasi
    // ulang tiap kali menemukan sinyal preferensi baru dari chat.
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id           UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        budget_min         NUMERIC,
        budget_max         NUMERIC,
        preferred_group_type TEXT     CHECK (preferred_group_type IN ('solo','couple','family','friends')),
        min_star_rating    NUMERIC,
        interests          TEXT[]     DEFAULT '{}',   -- e.g. ['pantai','private pool']
        dislikes           TEXT[]     DEFAULT '{}',   -- e.g. ['hiking']
        raw_signals        JSONB      DEFAULT '[]',   -- log mentah sinyal dari chat, buat audit/debug
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel user_preferences');

    await client.query('COMMIT');
    console.log('\n🎉 Migrasi selesai. Langkah selanjutnya:');
    console.log('  1. Tambahkan routes/controllers wishlist & preferences');
    console.log('  2. Update aiService.js untuk fetch & inject data ini ke prompt');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error migrasi:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
