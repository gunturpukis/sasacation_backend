// src/config/migrateTasks.js
// Migrasi A3 (audit Figma: kartu "Travel Task — Check-in Open — flight GA-421
// ... Seats: 12A, 12B, 12C").
//
// Tugas perjalanan milik user (pengingat check-in penerbangan, dokumen,
// pembayaran, dsb.), opsional terikat booking. Data penerbangan (nomor,
// kursi) disimpan di payload JSONB — diisi manual/app, bukan dari maskapai
// (tidak ada integrasi GDS).
//
// Jalankan: npm run db:migrate:tasks
// Aman dijalankan berkali-kali (idempotent).

require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔧 Menjalankan migrasi Travel Tasks (A3)...\n');
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS travel_tasks (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
        kind       TEXT NOT NULL DEFAULT 'reminder'
                   CHECK (kind IN ('flight_checkin','reminder','payment','document','other')),
        title      TEXT NOT NULL,
        detail     TEXT,
        due_at     TIMESTAMPTZ,
        payload    JSONB DEFAULT '{}',
        done       BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel travel_tasks');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_travel_tasks_user_due
        ON travel_tasks(user_id, done, due_at)
    `);

    await client.query('COMMIT');
    console.log('\n🎉 Migrasi tasks selesai.');
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
