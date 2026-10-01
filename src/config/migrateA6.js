// src/config/migrateA6.js
// Migrasi A6 (audit Figma: tombol "Transfer" di wallet + kartu
// "Travel Pass Premium / Sasacation Gold").
//
//   - wallet_transactions.type += transfer_in/transfer_out (transfer antar user)
//   - tier loyalitas dihitung ON READ (tidak ada tabel baru) — lihat
//     src/controllers/loyaltyController.js
//
// Jalankan: npm run db:migrate:a6
// Aman dijalankan berkali-kali (idempotent).

require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔧 Menjalankan migrasi A6 (transfer + tier)...\n');
    await client.query('BEGIN');

    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_type_check;
        ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_type_check
          CHECK (type IN ('topup','spend','refund','adjustment','transfer_in','transfer_out'));
      END $$;
    `);
    console.log('✅ wallet_transactions.type menerima transfer_in/out');

    await client.query('COMMIT');
    console.log('\n🎉 Migrasi A6 selesai.');
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
