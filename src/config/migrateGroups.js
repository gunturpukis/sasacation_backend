// src/config/migrateGroups.js
// Migrasi A2 (audit Figma: kartu "Group Budget Equity — Spending Gap Detected
// → View Suggestions / Dismiss").
//
//   - trip_groups (grup + budget bersama)
//   - group_members (anggota; pembuat otomatis anggota)
//   - group_expenses (pengeluaran + siapa yang bayar)
//
// Gap vs budget dihitung ON READ (summary) — tidak ada job latar belakang.
// Flutter tampilkan kartu equity bila summary.gap_status = 'over'.
//
// Jalankan: npm run db:migrate:groups
// Aman dijalankan berkali-kali (idempotent).

require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔧 Menjalankan migrasi Group Budget (A2)...\n');
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS trip_groups (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        destination  TEXT,
        budget_total NUMERIC NOT NULL DEFAULT 0 CHECK (budget_total >= 0),
        currency     TEXT NOT NULL DEFAULT 'USD',
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel trip_groups');

    await client.query(`
      CREATE TABLE IF NOT EXISTS group_members (
        group_id  UUID NOT NULL REFERENCES trip_groups(id) ON DELETE CASCADE,
        user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (group_id, user_id)
      )
    `);
    console.log('✅ Tabel group_members');

    await client.query(`
      CREATE TABLE IF NOT EXISTS group_expenses (
        id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id  UUID NOT NULL REFERENCES trip_groups(id) ON DELETE CASCADE,
        user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        label     TEXT NOT NULL,
        amount    NUMERIC NOT NULL CHECK (amount > 0),
        category  TEXT,
        spent_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel group_expenses');

    await client.query(`CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_group_expenses_group ON group_expenses(group_id, spent_at DESC)`);

    await client.query('COMMIT');
    console.log('\n🎉 Migrasi groups selesai.');
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
