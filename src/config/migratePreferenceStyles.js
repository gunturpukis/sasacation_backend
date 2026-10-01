// src/config/migratePreferenceStyles.js
// Migrasi P5 (FLUTTER_P3_CONTRACTS.md): Travel Styles.
//
// Hasil verifikasi: GET/PUT /api/preferences SUDAH ada (preferencesController),
// tapi skema belum punya gaya travel (relaxation/adventure/budget/gourmet)
// yang dibutuhkan kartu preferensi di Settings. Kolom ini menutup gap itu:
//   - PUT /api/preferences menerima { styles: ["adventure"] } (replace)
//   - GET mengembalikan styles[] apa adanya
//   - preferenceExtractorService ikut menambang styles dari chat (union)
//
// Jalankan: npm run db:migrate:preference-styles
// Aman dijalankan berkali-kali (idempotent).

require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔧 Menjalankan migrasi Preference Styles (P5)...\n');
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE user_preferences
      ADD COLUMN IF NOT EXISTS styles TEXT[] DEFAULT '{}'
    `);
    console.log("✅ Kolom user_preferences.styles (e.g. ['adventure','gourmet'])");

    await client.query('COMMIT');
    console.log('\n🎉 Migrasi preference styles selesai.');
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
