// // src/config/migratePartners.js
// // Migration untuk Poin 3 (BA audit): fondasi B2B — role 'partner' + tabel
// // 'properties' + relasi hotels -> properties. Sebelumnya semua hotel adalah
// // data flat milik platform sendiri, tidak ada konsep "mitra eksternal".
// //
// // Jalankan: npm run db:migrate:partners
// // Aman dijalankan berkali-kali (idempotent).

// require('dotenv').config();
// const pool = require('./db');

// async function migrate() {
//   const client = await pool.connect();
//   try {
//     console.log('🔧 Menjalankan migrasi Partner/B2B...\n');
//     await client.query('BEGIN');

//     // 1. users.role sekarang boleh 'partner'
//     await client.query(`
//       DO $$
//       BEGIN
//         ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
//         ALTER TABLE users ADD CONSTRAINT users_role_check
//           CHECK (role IN ('user','admin','partner'));
//       END $$;
//     `);
//     console.log("✅ users.role sekarang menerima 'partner'");

//     // 2. Tabel properties — representasi bisnis/mitra yang mendaftar.
//     //    Sengaja terpisah dari 'users' (bukan cuma tambah kolom di users)
//     //    karena 1 mitra bisa saja punya banyak properti di masa depan, dan
//     //    data bisnis (nama usaha, alamat, status verifikasi) secara konsep
//     //    beda dari data akun personal.
//     await client.query(`
//       CREATE TABLE IF NOT EXISTS properties (
//         id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
//         owner_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
//         business_name TEXT        NOT NULL,
//         description   TEXT,
//         phone         TEXT,
//         address       TEXT,
//         status        TEXT        NOT NULL DEFAULT 'pending'
//                                    CHECK (status IN ('pending','verified','rejected','suspended')),
//         rejection_reason TEXT,
//         created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
//         updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
//       );
//     `);
//     console.log('✅ Tabel properties dibuat');

//     await client.query(`CREATE INDEX IF NOT EXISTS idx_properties_owner ON properties(owner_id)`);
//     await client.query(`CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status)`);

//     // 3. hotels.property_id — NULLABLE dengan sengaja. Hotel yang sudah ada
//     //    (seed data) dianggap "milik platform" (property_id = NULL), bukan
//     //    dipaksa migrasi ke mitra manapun. Hotel baru dari mitra akan diisi
//     //    kolom ini saat dibuat (poin 4, endpoint CRUD hotel untuk mitra).
//     await client.query(`
//       ALTER TABLE hotels ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE SET NULL
//     `);
//     console.log('✅ Kolom hotels.property_id ditambahkan (nullable — NULL = milik platform)');

//     await client.query(`CREATE INDEX IF NOT EXISTS idx_hotels_property ON hotels(property_id)`);

//     await client.query('COMMIT');
//     console.log('\n🎉 Migrasi Partner/B2B selesai.');
//   } catch (err) {
//     await client.query('ROLLBACK');
//     console.error('❌ Migrasi gagal:', err.message);
//     throw err;
//   } finally {
//     client.release();
//     await pool.end();
//   }
// }

// migrate();
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
 