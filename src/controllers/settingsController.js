// src/controllers/settingsController.js
// B4 (layar Settings Figma): preferensi aplikasi per user — Push
// Notifications, Sasa AI Personalization, Language. Bukan preferensi travel
// (itu /api/preferences); ini saklar perilaku aplikasi.

const pool = require('../config/db');

const DEFAULTS = { push_enabled: true, ai_personalization: true, language: 'en' };

// Mata uang & kurs — KONFIG GLOBAL (bukan per user), single source of truth
// untuk Flutter Sprint 1. Semua harga API dalam `currency`; konversi ke IDR
// (Midtrans) memakai `usd_to_idr_rate`. Per-user currency = scope berikutnya.
const CURRENCY = process.env.DEFAULT_CURRENCY || 'USD';
const USD_TO_IDR_RATE = Number(process.env.MIDTRANS_USD_TO_IDR_RATE || 16000);

// GET /api/settings
const getSettings = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM user_settings WHERE user_id = $1', [req.user.id]);
    const s = rows[0] || { user_id: req.user.id, ...DEFAULTS };
    res.json({
      success: true,
      data: {
        user_id: s.user_id,
        push_enabled: s.push_enabled ?? true,
        ai_personalization: s.ai_personalization ?? true,
        language: s.language || 'en',
        currency: CURRENCY,
        usd_to_idr_rate: USD_TO_IDR_RATE,
      },
    });
  } catch (e) {
    // Tabel belum ada (migrasi B4 belum jalan) → default, bukan 500.
    if (e.code === '42P01') return res.json({ success: true, data: { user_id: req.user.id, ...DEFAULTS, currency: CURRENCY, usd_to_idr_rate: USD_TO_IDR_RATE } });
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// PUT /api/settings — partial update, key yang tidak dikirim tidak diubah.
const updateSettings = async (req, res) => {
  try {
    const { push_enabled, ai_personalization, language } = req.body;

    if (push_enabled !== undefined && typeof push_enabled !== 'boolean')
      return res.status(400).json({ success: false, message: 'push_enabled harus boolean' });
    if (ai_personalization !== undefined && typeof ai_personalization !== 'boolean')
      return res.status(400).json({ success: false, message: 'ai_personalization harus boolean' });
    if (language !== undefined && !['en', 'id'].includes(language))
      return res.status(400).json({ success: false, message: "language harus 'en' atau 'id'" });

    await pool.query(
      `INSERT INTO user_settings (user_id, push_enabled, ai_personalization, language, updated_at)
       VALUES ($1,
         COALESCE($2, true),
         COALESCE($3, true),
         COALESCE($4, 'en'),
         NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         push_enabled = COALESCE(EXCLUDED.push_enabled, user_settings.push_enabled),
         ai_personalization = COALESCE(EXCLUDED.ai_personalization, user_settings.ai_personalization),
         language = CASE WHEN $4 IS NULL THEN user_settings.language ELSE EXCLUDED.language END,
         updated_at = NOW()`,
      // HATI-HATI: COALESCE($2, true) di VALUES hanya untuk INSERT pertama;
      // UPDATE memakai COALESCE(EXCLUDED...) sehingga null = tidak diubah.
      // language ditangani via CASE karena default 'en' akan menimpa.
      [req.user.id, push_enabled ?? null, ai_personalization ?? null, language ?? null]
    );

    const { rows } = await pool.query('SELECT * FROM user_settings WHERE user_id = $1', [req.user.id]);
    res.json({ success: true, message: 'Pengaturan tersimpan', data: rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

module.exports = { getSettings, updateSettings, CURRENCY, USD_TO_IDR_RATE };
