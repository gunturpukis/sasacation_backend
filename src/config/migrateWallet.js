// src/config/migrateWallet.js
// Migrasi P2 (FLUTTER_P3_CONTRACTS.md): Travel Wallet.
//
// Aplikasi HANYA punya riwayat pembayaran per-transaksi booking (tabel
// `payments`). Saldo/poin/top-up belum ada sistemnya — file ini membuatnya:
//   - wallets (user_id PK, balance_cents, currency)
//   - wallet_transactions (riwayat khusus wallet, terpisah dari `payments`)
//   - loyalty_points (poin Sasa, 1 poin per $1 top-up sukses)
//
// Jalankan: npm run db:migrate:wallet
// Aman dijalankan berkali-kali (idempotent).

require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔧 Menjalankan migrasi Travel Wallet (P2)...\n');
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS wallets (
        user_id        UUID   PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        balance_cents  BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
        currency       TEXT   NOT NULL DEFAULT 'USD',
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel wallets');

    await client.query(`
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id             UUID   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type                TEXT   NOT NULL CHECK (type IN ('topup','spend','refund','adjustment')),
        amount_cents        BIGINT NOT NULL CHECK (amount_cents <> 0),
        balance_after_cents BIGINT,
        label               TEXT,
        reference_id        TEXT   UNIQUE,
        status              TEXT   NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','success','failed')),
        metadata            JSONB  DEFAULT '{}',
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel wallet_transactions');

    await client.query(`
      CREATE TABLE IF NOT EXISTS loyalty_points (
        user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        points     INT  NOT NULL DEFAULT 0 CHECK (points >= 0),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel loyalty_points');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_created
        ON wallet_transactions(user_id, created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_wallet_tx_reference
        ON wallet_transactions(reference_id)
    `);
    console.log('✅ Index wallet_transactions');

    await client.query('COMMIT');
    console.log('\n🎉 Migrasi wallet selesai.');
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
