// src/config/migrateFirebaseGeo.js
// Migration TAMBAHAN (non-destruktif) untuk database yang sudah pernah
// di-init sebelumnya via `npm run db:init`.
//
// Menambahkan:
//   - users.firebase_uid   → UID dari Firebase Auth (login Google/Apple/Email)
//   - users.fcm_token      → token device untuk push notification
//   - users.fcm_platform   → 'android' | 'ios' | 'web' (info device terakhir)
//   - users.latitude / users.longitude → lokasi terakhir user (opsional, untuk fitur "hotel terdekat dari saya")
//   - hotels.latitude / hotels.longitude → koordinat hotel (untuk fitur geolocation "hotel terdekat")
//
// Jalankan: npm run db:migrate:firebase-geo
// Aman dijalankan berkali-kali (pakai IF NOT EXISTS).

require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔧 Menjalankan migrasi Firebase + Geolocation...\n');
    await client.query('BEGIN');

    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid TEXT UNIQUE`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS fcm_token TEXT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS fcm_platform TEXT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS latitude NUMERIC`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS longitude NUMERIC`);
    console.log('✅ Kolom firebase_uid, fcm_token, fcm_platform, latitude, longitude ditambahkan ke tabel users');

    // provider_id dulu dipakai untuk social login manual (google/apple id apa adanya
    // dari client, TIDAK diverifikasi). Sekarang provider_id boleh tetap ada untuk
    // kompatibilitas data lama, tapi alur baru pakai firebase_uid yang sudah
    // diverifikasi oleh Firebase Admin SDK.

    await client.query(`ALTER TABLE hotels ADD COLUMN IF NOT EXISTS latitude NUMERIC`);
    await client.query(`ALTER TABLE hotels ADD COLUMN IF NOT EXISTS longitude NUMERIC`);
    console.log('✅ Kolom latitude, longitude ditambahkan ke tabel hotels');

    await client.query(`ALTER TABLE destinations ADD COLUMN IF NOT EXISTS latitude NUMERIC`);
    await client.query(`ALTER TABLE destinations ADD COLUMN IF NOT EXISTS longitude NUMERIC`);
    console.log('✅ Kolom latitude, longitude ditambahkan ke tabel destinations');

    await client.query(`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS latitude NUMERIC`);
    await client.query(`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS longitude NUMERIC`);
    console.log('✅ Kolom latitude, longitude ditambahkan ke tabel restaurants');

    await client.query('COMMIT');
    console.log('\n🎉 Migrasi selesai. Jalankan `npm run db:seed` ulang (opsional) kalau ingin mengisi koordinat contoh untuk data Lombok yang sudah ada, atau update manual lewat SQL.');
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
