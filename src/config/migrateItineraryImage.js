// src/config/migrateItineraryImage.js
// Migrasi image itinerary: kolom `image` per item — trip plan AI kini
// menyertakan URL gambar grounded (hotels/destinations/restaurants.image),
// dan hasil simpanannya (POST /api/itineraries + POST /:id/items) ikut
// menyimpannya supaya "View Itinerary" bisa menampilkan gambar.
//
// Jalankan: npm run db:migrate:itinerary-image
// Aman dijalankan berkali-kali (idempotent).

require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔧 Menjalankan migrasi Itinerary Image...\n');
    await client.query('BEGIN');

    await client.query('ALTER TABLE itinerary_items ADD COLUMN IF NOT EXISTS image TEXT');
    console.log('✅ Kolom itinerary_items.image');

    await client.query('COMMIT');
    console.log('\n🎉 Migrasi itinerary image selesai.');
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
