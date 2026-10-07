// src/config/migrateProfileExt.js
// Migrasi F.4 (AI_FEATURES_BE_PLAN.md): Traveler Profile extension.
//
// Menambah kolom eksplisit untuk profil travel di user_preferences:
//   - budget_tier TEXT (budget|mid|comfort|luxury) — turunan/override dari budget_min/max
//   - trip_types TEXT[] — mis. ["couple","family","solo","friends","staycation","honeymoon"]
//   - amenity_prefs TEXT[] — mis. ["pool","bathtub","breakfast","wifi"]
//   - location_prefs TEXT[] — mis. ["jakarta","bali","beach","city"]
//
// Jalankan: npm run db:migrate:profile-ext
// Aman dijalankan berkali-kali (idempotent).
require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔧 Menjalankan migrasi Traveler Profile extension (F.4)...\n');
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE user_preferences
      ADD COLUMN IF NOT EXISTS budget_tier TEXT
    `);
    console.log('✅ Kolom user_preferences.budget_tier');

    await client.query(`
      ALTER TABLE user_preferences
      ADD COLUMN IF NOT EXISTS trip_types TEXT[] DEFAULT '{}'
    `);
    console.log('✅ Kolom user_preferences.trip_types');

    await client.query(`
      ALTER TABLE user_preferences
      ADD COLUMN IF NOT EXISTS amenity_prefs TEXT[] DEFAULT '{}'
    `);
    console.log('✅ Kolom user_preferences.amenity_prefs');

    await client.query(`
      ALTER TABLE user_preferences
      ADD COLUMN IF NOT EXISTS location_prefs TEXT[] DEFAULT '{}'
    `);
    console.log('✅ Kolom user_preferences.location_prefs');

    await client.query('COMMIT');
    console.log('\n🎉 Migrasi profile extension selesai.');
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
