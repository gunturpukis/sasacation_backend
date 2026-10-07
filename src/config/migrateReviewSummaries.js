// src/config/migrateReviewSummaries.js
// Migrasi F.2 (AI Review Summary): tabel cache hasil ringkasan review per hotel.
//
// Summarizer BE menghitung 1x per hotel (batch/on-demand + cache), BUKAN
// per-request — latensi Ollama lokal 120s+ tidak cocok untuk request sinkron.
// Recompute bila review baru masuk atau cache > 7 hari (lihat
// reviewSummaryService.js).
//
// Jalankan: npm run db:migrate:review-summaries
// Aman dijalankan berkali-kali (idempotent).

require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔧 Menjalankan migrasi Review Summaries (F.2)...\n');
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS review_summaries (
        hotel_id      UUID        PRIMARY KEY REFERENCES hotels(id) ON DELETE CASCADE,
        pros          TEXT[]      NOT NULL DEFAULT '{}',
        cons          TEXT[]      NOT NULL DEFAULT '{}',
        avg_rating    NUMERIC(3,2),
        review_count  INT         NOT NULL DEFAULT 0,
        summary_text  TEXT,
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel review_summaries');

    await client.query('COMMIT');
    console.log('\n🎉 Migrasi review summaries selesai.');
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
