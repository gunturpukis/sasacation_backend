// src/config/migratePaymentGateway.js
// Migration TAMBAHAN (non-destruktif) untuk mendukung integrasi Midtrans
// menggantikan payment simulator sebelumnya.
//
// Menambahkan:
//   - payments.status  → tambah 'pending' ke CHECK constraint (sebelumnya
//                         cuma 'success'|'failed'|'refunded', padahal payment
//                         gateway asli SELALU mulai dari 'pending' sampai
//                         user menyelesaikan pembayaran di halaman Midtrans)
//   - payments.gateway_response → JSONB, simpan payload mentah dari webhook
//                         Midtrans untuk audit/debug (opsional tapi berguna)
//
// Jalankan: npm run db:migrate:payment-gateway
// Aman dijalankan berkali-kali.

require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔧 Menjalankan migrasi Payment Gateway (Midtrans)...\n');
    await client.query('BEGIN');

    // Ganti CHECK constraint payments.status supaya menerima 'pending'.
    // Nama constraint default Postgres untuk kolom ini: payments_status_check
    // (pola <table>_<column>_check). Dibungkus DO block supaya tidak error
    // kalau constraint-nya sudah pernah diganti sebelumnya (idempotent).
    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
        ALTER TABLE payments ADD CONSTRAINT payments_status_check
          CHECK (status IN ('pending','success','failed','refunded'));
      END $$;
    `);
    console.log("✅ payments.status sekarang menerima 'pending'");

    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway_response JSONB`);
    console.log('✅ Kolom gateway_response (JSONB) ditambahkan ke tabel payments');

    // paid_at sebelumnya NOT NULL DEFAULT NOW() — sekarang payment dibuat
    // dalam status 'pending' SEBELUM benar-benar dibayar, jadi paid_at harus
    // boleh NULL sampai webhook konfirmasi sukses.
    await client.query(`ALTER TABLE payments ALTER COLUMN paid_at DROP NOT NULL`);
    await client.query(`ALTER TABLE payments ALTER COLUMN paid_at DROP DEFAULT`);
    console.log('✅ payments.paid_at sekarang nullable (diisi saat webhook sukses, bukan saat insert)');

    await client.query('COMMIT');
    console.log('\n🎉 Migrasi payment gateway selesai.');
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
