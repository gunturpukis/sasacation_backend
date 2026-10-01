// src/config/migratePolls.js
// Migrasi A1 (audit Figma: kartu "Group Activity — New Vote: Sunset Dinner
// → Vote now").
//
//   - polls (pertanyaan + pembuat + batas waktu)
//   - poll_options (pilihan jawaban)
//   - poll_votes (1 suara per user per poll, bisa pindah pilihan via upsert)
//
// Cakupan A1: vote terbuka antar user login (discovery "open"). Kalau A2
// (trip groups) selesai, poll bisa dikaitkan ke grup tanpa ubah skema inti.
//
// Jalankan: npm run db:migrate:polls
// Aman dijalankan berkali-kali (idempotent).

require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔧 Menjalankan migrasi Polls (A1)...\n');
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS polls (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title       TEXT NOT NULL,
        description TEXT,
        status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
        closes_at   TIMESTAMPTZ,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel polls');

    await client.query(`
      CREATE TABLE IF NOT EXISTS poll_options (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        poll_id    UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
        label      TEXT NOT NULL,
        position   INT  NOT NULL DEFAULT 0
      )
    `);
    console.log('✅ Tabel poll_options');

    await client.query(`
      CREATE TABLE IF NOT EXISTS poll_votes (
        poll_id    UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
        option_id  UUID NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
        user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (poll_id, user_id)
      )
    `);
    console.log('✅ Tabel poll_votes');

    await client.query(`CREATE INDEX IF NOT EXISTS idx_polls_open ON polls(status, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_poll_options_poll ON poll_options(poll_id, position)`);

    await client.query('COMMIT');
    console.log('\n🎉 Migrasi polls selesai.');
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
