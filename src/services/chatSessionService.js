// src/services/chatSessionService.js
// Mengelola persistensi percakapan AI supaya bisa dipulihkan lintas sesi app
// (buka app lagi besok → chat sebelumnya masih ada), dan menjadi sumber data
// mentah untuk preferenceExtractorService.
//
// Desain v1 sengaja simpel: SATU sesi aktif per user (bukan multi-thread
// seperti ChatGPT). Kalau nanti butuh multi-sesi/riwayat percakapan terpisah,
// tinggal tambah UI pemilih sesi — schema-nya sudah mendukung (chat_sessions
// per-user, bukan singleton), tidak perlu migrasi ulang.

const pool = require('../config/db');

// Ambil sesi yang sedang berjalan (kalau sessionId dikirim & valid & punya
// user ini), atau buat sesi baru kalau belum ada / sessionId tidak valid.
async function getOrCreateSession(userId, sessionId) {
  if (sessionId) {
    const existing = await pool.query(
      'SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2',
      [sessionId, userId]
    );
    if (existing.rows.length > 0) return existing.rows[0].id;
    // sessionId dikirim tapi bukan milik user ini / sudah tidak ada →
    // jangan error, cukup buat sesi baru (fail-soft, chat tetap jalan)
  }

  const created = await pool.query(
    'INSERT INTO chat_sessions (user_id) VALUES ($1) RETURNING id',
    [userId]
  );
  return created.rows[0].id;
}

async function appendMessage(sessionId, role, content) {
  await pool.query(
    'INSERT INTO chat_messages (session_id, role, content) VALUES ($1, $2, $3)',
    [sessionId, role, content]
  );
  await pool.query('UPDATE chat_sessions SET updated_at = NOW() WHERE id = $1', [sessionId]);

  // Judul sesi = potongan pesan pertama user, biar kalau nanti ada UI daftar
  // sesi, tidak semuanya bertuliskan "New Chat"
  if (role === 'user') {
    await pool.query(
      `UPDATE chat_sessions SET title = COALESCE(title, LEFT($2, 60))
       WHERE id = $1`,
      [sessionId, content]
    );
  }
}

// Dipakai app saat startup untuk restore percakapan terakhir ke AiBloc
async function getLatestSessionWithMessages(userId) {
  const session = await pool.query(
    `SELECT id, title, updated_at FROM chat_sessions
     WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [userId]
  );
  if (session.rows.length === 0) return null;

  const sessionId = session.rows[0].id;
  const messages = await pool.query(
    `SELECT role, content, created_at FROM chat_messages
     WHERE session_id = $1 ORDER BY created_at ASC`,
    [sessionId]
  );

  return {
    sessionId,
    title: session.rows[0].title,
    messages: messages.rows,
  };
}

// Dipakai preferenceExtractorService: ambil N pesan terakhir untuk dianalisis
async function getRecentMessages(sessionId, limit = 10) {
  const { rows } = await pool.query(
    `SELECT role, content FROM chat_messages
     WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [sessionId, limit]
  );
  return rows.reverse(); // urut kronologis lagi
}

// Total pesan user dalam sesi — dipakai sebagai trigger kapan ekstraksi jalan
// (lihat aiController.js: baru diekstrak tiap kelipatan 3 pesan user, supaya
// tidak boros memanggil LLM di setiap single turn)
async function countUserMessages(sessionId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) FROM chat_messages WHERE session_id = $1 AND role = 'user'`,
    [sessionId]
  );
  return parseInt(rows[0].count, 10);
}

module.exports = {
  getOrCreateSession,
  appendMessage,
  getLatestSessionWithMessages,
  getRecentMessages,
  countUserMessages,
};
