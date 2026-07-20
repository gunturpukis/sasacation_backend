// src/services/userContextService.js
// Mengumpulkan "siapa user ini" dari 3 sumber: preferences eksplisit,
// wishlist, dan riwayat booking — lalu meringkasnya jadi satu blok teks
// yang siap disisipkan ke system prompt Ollama.
//
// Ini yang menghubungkan RAG (soal katalog) dengan Travel Memory (soal user).
// Tanpa file ini, aiService.js hanya tahu tentang hotel/destinasi, tidak
// pernah tahu tentang user yang sedang chat.

const pool = require('../config/db');

async function getUserContext(userId) {
  if (!userId) return null; // user belum login → tidak ada konteks personal

  const [prefsResult, wishlistResult, bookingResult] = await Promise.all([
    pool.query('SELECT * FROM user_preferences WHERE user_id = $1', [userId]),
    pool.query(
      `SELECT h.name, h.location FROM wishlist w
       JOIN hotels h ON h.id = w.hotel_id
       WHERE w.user_id = $1 ORDER BY w.created_at DESC LIMIT 5`,
      [userId]
    ),
    pool.query(
      `SELECT h.name, h.location, b.check_in, b.check_out, b.status
       FROM bookings b JOIN hotels h ON h.id = b.hotel_id
       WHERE b.user_id = $1 ORDER BY b.created_at DESC LIMIT 5`,
      [userId]
    ),
  ]);

  const prefs = prefsResult.rows[0];
  const wishlist = wishlistResult.rows;
  const bookings = bookingResult.rows;

  // Kalau semuanya kosong (user baru), jangan kirim blok kosong ke prompt
  if (!prefs && wishlist.length === 0 && bookings.length === 0) return null;

  const lines = [];
  if (prefs) {
    if (prefs.budget_min || prefs.budget_max)
      lines.push(`Budget biasanya: $${prefs.budget_min || 0}–$${prefs.budget_max || '?'}`);
    if (prefs.preferred_group_type) lines.push(`Biasanya bepergian: ${prefs.preferred_group_type}`);
    if (prefs.min_star_rating) lines.push(`Minimal rating hotel yang disukai: ${prefs.min_star_rating} bintang`);
    if (prefs.interests?.length) lines.push(`Minat: ${prefs.interests.join(', ')}`);
    if (prefs.dislikes?.length) lines.push(`Tidak suka: ${prefs.dislikes.join(', ')}`);
  }
  if (wishlist.length) {
    lines.push(`Wishlist saat ini: ${wishlist.map(w => `${w.name} (${w.location})`).join('; ')}`);
  }
  if (bookings.length) {
    lines.push(`Riwayat booking terakhir: ${bookings.map(b => `${b.name}, ${b.location} (${b.status})`).join('; ')}`);
  }

  return lines.length ? lines.join('\n') : null;
}

module.exports = { getUserContext };
