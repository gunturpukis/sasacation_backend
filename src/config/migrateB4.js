// src/config/migrateB4.js
// Migrasi B4 (audit Figma, gap kecil batch):
//   1. payment_methods.label — julukan kartu ("Business") seperti layar wallet.
//   2. hotels.cleaning_fee — rincian "Cleaning fee" di Price Summary.
//   3. user_settings — toggle Settings (push, personalisasi AI, bahasa).
//
// Jalankan: npm run db:migrate:b4
// Aman dijalankan berkali-kali (idempotent).

require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔧 Menjalankan migrasi B4...\n');
    await client.query('BEGIN');

    await client.query(`ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS label TEXT`);
    console.log('✅ Kolom payment_methods.label');

    await client.query(`ALTER TABLE hotels ADD COLUMN IF NOT EXISTS cleaning_fee NUMERIC NOT NULL DEFAULT 0`);
    console.log('✅ Kolom hotels.cleaning_fee');

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        push_enabled       BOOLEAN NOT NULL DEFAULT true,
        ai_personalization BOOLEAN NOT NULL DEFAULT true,
        language           TEXT    NOT NULL DEFAULT 'en' CHECK (language IN ('en','id')),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel user_settings');

    await client.query('COMMIT');
    console.log('\n🎉 Migrasi B4 selesai.');
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
