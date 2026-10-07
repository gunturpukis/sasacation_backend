// src/config/migrateHotelVibes.js
// Migrasi F.1 (AI Hotel Search): taksonomi vibe untuk grounding.
// Dipilih hotel_vibes (normalized) sesuai keputusan: query fleksibel,
// confidence per vibe, tanpa mengarang di LLM.
//
// Vibes awal: quiet/tenang, romantic/romantis, family/keluarga,
// luxury/mewah, budget/murah, nightlife, beach, culture, adventure, nature.
//
// Jalankan: npm run db:migrate:hotel-vibes
// Aman dijalankan berkali-kali (idempotent).
require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔧 Menjalankan migrasi Hotel Vibes (F.1)...\n');
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS hotel_vibes (
        hotel_id   UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
        vibe       TEXT NOT NULL CHECK (vibe IN ('quiet','romantic','family','luxury','budget','nightlife','beach','culture','adventure','nature','couple','business')),
        confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
        source     TEXT NOT NULL DEFAULT 'seed' CHECK (source IN ('seed','admin','ai')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (hotel_id, vibe)
      )
    `);
    console.log('✅ Tabel hotel_vibes');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_hotel_vibes_vibe ON hotel_vibes(vibe)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_hotel_vibes_hotel ON hotel_vibes(hotel_id)
    `);

    // Seed awal dari amenities + description yang sudah ada (deterministik,
    // bukan LLM — anti halusinasi). Confidence 0.7 untuk seed heuristik.
    await client.query(`
      INSERT INTO hotel_vibes (hotel_id, vibe, confidence, source)
      SELECT id, 'beach', 0.8, 'seed' FROM hotels
      WHERE description ILIKE '%pantai%' OR description ILIKE '%beach%'
        OR amenities::text ILIKE '%beach%'
      ON CONFLICT (hotel_id, vibe) DO NOTHING
    `);
    await client.query(`
      INSERT INTO hotel_vibes (hotel_id, vibe, confidence, source)
      SELECT id, 'quiet', 0.7, 'seed' FROM hotels
      WHERE description ILIKE '%tenang%' OR description ILIKE '%terpencil%' OR description ILIKE '%tropis%'
      ON CONFLICT (hotel_id, vibe) DO NOTHING
    `);
    await client.query(`
      INSERT INTO hotel_vibes (hotel_id, vibe, confidence, source)
      SELECT id, 'romantic', 0.7, 'seed' FROM hotels
      WHERE description ILIKE '%romantis%' OR description ILIKE '%private pool%' OR description ILIKE '%villa pribadi%'
        OR amenities::text ILIKE '%private pool%' OR amenities::text ILIKE '%butler%'
      ON CONFLICT (hotel_id, vibe) DO NOTHING
    `);
    await client.query(`
      INSERT INTO hotel_vibes (hotel_id, vibe, confidence, source)
      SELECT id, 'luxury', 0.8, 'seed' FROM hotels
      WHERE price >= 250 OR description ILIKE '%mewah%' OR description ILIKE '%bintang 5%'
        OR amenities::text ILIKE '%butler%'
      ON CONFLICT (hotel_id, vibe) DO NOTHING
    `);
    await client.query(`
      INSERT INTO hotel_vibes (hotel_id, vibe, confidence, source)
      SELECT id, 'family', 0.7, 'seed' FROM hotels
      WHERE description ILIKE '%keluarga%' OR description ILIKE '%budaya%' OR description ILIKE '%cultural%'
        OR amenities::text ILIKE '%cultural%'
      ON CONFLICT (hotel_id, vibe) DO NOTHING
    `);
    await client.query(`
      INSERT INTO hotel_vibes (hotel_id, vibe, confidence, source)
      SELECT id, 'couple', 0.7, 'seed' FROM hotels
      WHERE description ILIKE '%honeymoon%' OR description ILIKE '%pasangan%'
        OR amenities::text ILIKE '%private pool%'
      ON CONFLICT (hotel_id, vibe) DO NOTHING
    `);
    console.log('✅ Seed heuristik hotel_vibes');

    await client.query('COMMIT');
    console.log('\n🎉 Migrasi hotel vibes selesai.');
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
