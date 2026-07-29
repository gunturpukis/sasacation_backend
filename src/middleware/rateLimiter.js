
// src/middleware/rateLimiter.js
// FIX audit keamanan: sebelumnya TIDAK ADA rate limiting sama sekali di
// seluruh API — endpoint login rentan brute-force, endpoint AI (yang
// memanggil Ollama, biaya compute) rentan disalahgunakan tanpa batas.
//
// Dua limiter terpisah dengan tujuan berbeda:
// - loginLimiter: mencegah brute-force password (ketat, per-IP)
// - aiLimiter: mencegah abuse biaya compute Ollama (agak longgar, per-IP —
//   idealnya per-user kalau traffic sudah besar, tapi per-IP cukup untuk skala sekarang)
 
const rateLimit = require('express-rate-limit');
 
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 5, // maksimal 5 percobaan login per IP per window
  message: { success: false, message: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' },
  standardHeaders: true,
  legacyHeaders: false,
  // Jangan hitung percobaan yang BERHASIL — biar user yang lupa password
  // sekali dua kali salah ketik tidak langsung kena limit permanen
  skipSuccessfulRequests: true,
});
 
const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 menit
  max: 20, // maksimal 20 request/menit per IP ke endpoint AI
  message: { success: false, message: 'Terlalu banyak request ke AI. Tunggu sebentar lalu coba lagi.' },
  standardHeaders: true,
  legacyHeaders: false,
});
 
// Limiter umum untuk endpoint publik lain (hotels/explore/dll) — lebih
// longgar, cuma jaga-jaga dari bot/scraper agresif, bukan untuk membatasi
// pemakaian normal.
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
 
module.exports = { loginLimiter, aiLimiter, generalLimiter };
 