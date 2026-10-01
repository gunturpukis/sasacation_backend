// src/config/migrateBookingPending.js
// Migrasi B1 (audit Figma: layar My Trips "Pending / Action Required /
// Complete Booking").
//
// Sebelumnya booking langsung 'confirmed' walau pembayaran masih pending —
// tidak ada keadaan "menunggu bayar" yang bisa ditampilkan + dilanjutkan.
// Sekarang: /pay membuat booking 'pending'; webhook sukses → 'confirmed',
// gagal/expired → 'cancelled'. Kolom snap_* di payments menyimpan data
// Snap supaya pembayaran pending bisa DILANJUTKAN (resume) dari My Trips.
//
// Jalankan: npm run db:migrate:booking-pending
// Aman dijalankan berkali-kali (idempotent).

require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔧 Menjalankan migrasi Booking Pending (B1)...\n');
    await client.query('BEGIN');

    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
        ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
          CHECK (status IN ('pending','confirmed','cancelled','completed'));
      END $$;
    `);
    console.log("✅ bookings.status sekarang menerima 'pending'");

    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS snap_token TEXT`);
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS redirect_url TEXT`);
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS snap_expires_at TIMESTAMPTZ`);
    console.log('✅ Kolom snap_token/redirect_url/snap_expires_at di payments');

    await client.query('COMMIT');
    console.log('\n🎉 Migrasi booking pending selesai.');
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
