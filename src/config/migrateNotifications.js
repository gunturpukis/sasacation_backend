
// src/config/migrateNotifications.js
// Jalankan sekali: node src/config/migrateNotifications.js
//
// SEBELUM: push notification (FCM) sifatnya kirim-lalu-lupa — begitu terkirim,
// tidak ada jejaknya di server. Kalau user tidak lihat notifikasi push saat
// itu juga (device mati, notif ke-swipe, dll), notifikasinya hilang selamanya.
// Tidak ada "Notifications" screen di app karena memang tidak ada apa pun
// untuk ditampilkan.
//
// SEKARANG: setiap kali sistem mengirim push notification yang relevan buat
// user (bukan test notification), juga disimpan ke tabel ini — supaya ada
// riwayat yang bisa ditampilkan di in-app notification center.
 
require('dotenv').config();
const pool = require('./db');
 
async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔧 Menambahkan tabel notifications...\n');
    await client.query('BEGIN');
 
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title      TEXT        NOT NULL,
        body       TEXT        NOT NULL,
        type       TEXT        NOT NULL DEFAULT 'general',
        data       JSONB       DEFAULT '{}',
        read_at    TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel notifications');
 
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_user_created
        ON notifications(user_id, created_at DESC)
    `);
 
    await client.query('COMMIT');
    console.log('\n🎉 Migrasi selesai. Langkah selanjutnya:');
    console.log('  1. Update notificationService.js (tambah persistNotification)');
    console.log('  2. Update checkoutController.js supaya juga persist saat kirim push');
    console.log('  3. Tambah endpoint GET /api/notifications & PATCH /:id/read');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error migrasi:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}
 
migrate();