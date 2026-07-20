// src/config/migrateChatMemory.js
// Jalankan sekali: node src/config/migrateChatMemory.js
// Menambahkan persistensi percakapan AI (Travel Memory bagian #2).
//
// Kenapa terpisah dari migrateUserData.js: mengikuti pola migrasi Anda yang
// sudah ada (migrateFirebaseGeo.js, migratePartners.js, migratePaymentGateway.js
// masing-masing satu migrasi per file) — memudahkan rollback/audit per fitur.
//
// PRASYARAT: migrateUserData.js sudah dijalankan lebih dulu (butuh tabel `users`
// yang sudah ada dari initDB.js — itu prasyarat dasar, sudah pasti ada).

require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔧 Menambahkan tabel chat memory...\n');
    await client.query('BEGIN');

    // Satu sesi = satu "percakapan" berkelanjutan. User bisa punya banyak sesi
    // (mis. sesi lama dibuka lagi minggu depan), tapi untuk v1 kita hanya
    // pakai sesi PALING BARU sebagai working memory (lihat chatSessionService).
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title      TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel chat_sessions');

    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID        NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role       TEXT        NOT NULL CHECK (role IN ('user','assistant')),
        content    TEXT        NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel chat_messages');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_updated
        ON chat_sessions(user_id, updated_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_messages_session
        ON chat_messages(session_id, created_at)
    `);

    await client.query('COMMIT');
    console.log('\n🎉 Migrasi selesai. Langkah selanjutnya:');
    console.log('  1. Tambahkan chatSessionService.js, preferenceExtractorService.js');
    console.log('  2. Update aiController.js untuk persist pesan + trigger ekstraksi');
    console.log('  3. Mount route /api/chat/sessions di index.js');
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
