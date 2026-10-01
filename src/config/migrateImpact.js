// src/config/migrateImpact.js
// Migrasi P3 (FLUTTER_P3_CONTRACTS.md): Local Impact Score.
//
// Yang dibutuhkan layar Sustainibility versi Figma:
//   - Flag is_local_business di hotels (kontrak: "flag is_local_business
//     (atau tabel merchants) pada hotel/merchant") — dipilih flag boolean
//     karena 1 hotel = 1 usaha, tidak perlu tabel merchants terpisah.
//   - Skor + sertifikat dihitung DERIVASI dari payments sukses (bukan data
//     palsu): lihat src/controllers/impactController.js.
//
// Jalankan: npm run db:migrate:impact
// Aman dijalankan berkali-kali (idempotent).

require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔧 Menjalankan migrasi Local Impact (P3)...\n');
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE hotels ADD COLUMN IF NOT EXISTS is_local_business BOOLEAN NOT NULL DEFAULT false
    `);
    console.log('✅ Kolom hotels.is_local_business');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_hotels_local_business
        ON hotels(is_local_business) WHERE is_local_business = true
    `);
    console.log('✅ Index idx_hotels_local_business');

    await client.query('COMMIT');
    console.log('\n🎉 Migrasi impact selesai.');
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
