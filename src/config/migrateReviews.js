// src/config/migrateReviews.js
// Migrasi P1 (FLUTTER_P3_CONTRACTS.md): Guest Reviews untuk GET /hotels/:id.
//
// Flutter sudah render section "Guest Reviews" + bottom sheet "See all" bila
// respons detail hotel menyertakan array `reviews`. Sebelum migrasi ini key
// tersebut tidak ada → section tersembunyi.
//
// Skema bebas (kontrak JSON yang penting), dipilih tabel `reviews` terpisah
// supaya bisa JOIN/subquery + filter "tanpa teks di-skip" di level SQL.
//
// Jalankan: npm run db:migrate:reviews
// Aman dijalankan berkali-kali (idempotent).

require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔧 Menjalankan migrasi Reviews (P1)...\n');
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        hotel_id   UUID        NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
        user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
        user_name  TEXT        NOT NULL,
        avatar     TEXT,
        rating     NUMERIC(2,1) NOT NULL CHECK (rating >= 1 AND rating <= 5),
        stayed     TEXT,
        text       TEXT        NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel reviews');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_reviews_hotel_created
        ON reviews(hotel_id, created_at DESC)
    `);
    console.log('✅ Index idx_reviews_hotel_created');

    await client.query('COMMIT');
    console.log('\n🎉 Migrasi reviews selesai.');
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
