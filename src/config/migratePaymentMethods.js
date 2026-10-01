// src/config/migratePaymentMethods.js
// Migrasi P4 (FLUTTER_P3_CONTRACTS.md): Saved Payment Methods (Midtrans vault).
//
// Model Midtrans: kartu TIDAK disimpan di kita — yang disimpan hanya token
// (`saved_token_id`) hasil tokenisasi Snap. Saat checkout dengan
// `credit_card.save_card=true` + `user_id`, Snap menampilkan toggle "save
// card"; kalau user setuju + pembayaran sukses, webhook membawa
// `saved_token_id`, `saved_token_id_expired_at` (tanggal kedaluwarsa kartu)
// dan `masked_card` ("48111111-1114"). Tiga field itu yang dipersist di sini.
// Detail PAN/CVV tidak pernah menyentuh server kita (PCI-safe).
//
// GET /api/payment-methods → [{ id, brand, last4, exp, is_primary }]
// `saved_token_id` TIDAK PERNAH diekspos ke client.
//
// Jalankan: npm run db:migrate:payment-methods
// Aman dijalankan berkali-kali (idempotent).

require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔧 Menjalankan migrasi Saved Payment Methods (P4)...\n');
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS payment_methods (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        brand           TEXT NOT NULL DEFAULT 'unknown'
                        CHECK (brand IN ('visa','mastercard','amex','jcb','unknown')),
        last4           TEXT NOT NULL CHECK (last4 ~ '^[0-9]{4}$'),
        exp_month       INT  CHECK (exp_month BETWEEN 1 AND 12),
        exp_year        INT,
        saved_token_id  TEXT NOT NULL,
        token_expires_at TIMESTAMPTZ,
        is_primary      BOOLEAN NOT NULL DEFAULT false,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, saved_token_id)
      )
    `);
    console.log('✅ Tabel payment_methods');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_payment_methods_user
        ON payment_methods(user_id, created_at DESC)
    `);
    console.log('✅ Index idx_payment_methods_user');

    await client.query('COMMIT');
    console.log('\n🎉 Migrasi payment methods selesai.');
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
