// src/config/migrateChatTripPlan.js
// Migrasi F.5: persistensi tripPlan dari Agent Workflow di chat.
//
// Masalah: kartu itinerary hasil deteksi intent trip-planning di /ai/chat
// hanya hidup di memori respons (ChatMessage.tripPlan di FE hilang saat
// restore — lihat ai_model.dart). Dengan kolom ini, kartu bisa dibuka ulang
// setelah app restart via GET /chat/sessions/latest.
//
// Jalankan: npm run db:migrate:chat-trip-plan
// Aman dijalankan berkali-kali (idempotent).

require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔧 Menjalankan migrasi Chat Trip Plan (F.5)...\n');
    await client.query(`
      ALTER TABLE chat_messages
      ADD COLUMN IF NOT EXISTS trip_plan JSONB NULL
    `);
    console.log('✅ Kolom chat_messages.trip_plan');
    console.log('\n🎉 Migrasi chat trip plan selesai.');
  } catch (err) {
    console.error('❌ Migrasi gagal:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
