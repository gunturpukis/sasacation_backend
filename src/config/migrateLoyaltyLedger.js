// src/config/migrateLoyaltyLedger.js
// Migrasi Loyalty Ledger (LOYALTY_DEFINITION.md §4, disetujui 04 Okt 2026).
//
// Keputusan produk: loyalty points SAJA, bukan e-money. Setiap perolehan /
// pemakaian poin dicatat sebagai baris ledger (audit trail) — saldo adalah
// turunan SUM, bukan kolom yang di-update. Kolom lama `loyalty_points.points`
// dipertahankan sebagai cache/kompatibilitas dan disinkronkan oleh service.
//
// - earn_register  +50  (pendaftaran akun baru)
// - earn_review    +25  (HOOK DITUNDA: belum ada endpoint tulis review —
//                        baru GET. Pasang hook saat POST /reviews dibangun.)
// - earn_booking   1/Rp10rb (HOOK DITUNDA: belum ada transisi booking
//                        completed/close. Pasang hook saat flow itu ada.)
// - earn_topup     1/$1 (dual-write dari wallet webhook, kompatibilitas)
// - transfer_in/out, redeem (-), clawback/re-credit
// - expires_at: perolehan kedaluwarsa 12 bulan (FIFO eksak = scope
//   berikutnya; v1 memakai saldo = SUM yang belum kedaluwarsa).
//
// Jalankan: npm run db:migrate:loyalty-ledger
// Aman dijalankan berkali-kali (idempotent).
require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔧 Menjalankan migrasi Loyalty Ledger...\n');
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS loyalty_ledger (
        id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        points       INT         NOT NULL CHECK (points <> 0),
        type         TEXT        NOT NULL CHECK (type IN (
                       'earn_register','earn_review','earn_booking','earn_topup',
                       'legacy_migration',
                       'transfer_in','transfer_out',
                       'redeem','recredit','clawback')),
        reference_id TEXT        UNIQUE,
        note         TEXT,
        expires_at   TIMESTAMPTZ,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel loyalty_ledger');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_user_created
        ON loyalty_ledger(user_id, created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_user_expiry
        ON loyalty_ledger(user_id, expires_at)
    `);

    // Jejak redeem per pembayaran — untuk re-credit saat refund penuh dan
    // audit "50% dari subtotal" (LOYALTY_DEFINITION.md §2).
    await client.query(`
      ALTER TABLE payments
      ADD COLUMN IF NOT EXISTS redeemed_points INT NOT NULL DEFAULT 0
    `);
    console.log('✅ Kolom payments.redeemed_points');

    await client.query('COMMIT');
    console.log('\n🎉 Migrasi loyalty ledger selesai.');
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
