// src/controllers/preferencesController.js
const pool = require('../config/db');

// P5 (FLUTTER_P3_CONTRACTS.md): kosakata gaya travel yang disepakati dengan
// Flutter (kartu preferensi di Settings + ikon per gaya). Disimpan lowercase.
const ALLOWED_STYLES = ['relaxation', 'adventure', 'budget', 'gourmet', 'culture', 'nature', 'luxury'];

function normalizeStyles(input) {
  if (input === undefined) return undefined; // tidak dikirim → jangan ubah
  if (!Array.isArray(input))
    return { error: 'styles harus array string, mis. ["adventure","gourmet"]' };
  const clean = [...new Set(
    input.filter(s => typeof s === 'string').map(s => s.trim().toLowerCase()).filter(Boolean)
  )].slice(0, 10);
  const invalid = clean.filter(s => !ALLOWED_STYLES.includes(s));
  if (invalid.length > 0)
    return { error: `styles tidak dikenal: ${invalid.join(', ')}. Pilih dari: ${ALLOWED_STYLES.join(', ')}` };
  return { value: clean };
}

// GET /api/preferences — profil preferensi user saat ini
const getPreferences = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM user_preferences WHERE user_id = $1',
      [req.user.id]
    );
    // Kalau belum ada, kembalikan default kosong (bukan 404) —
    // supaya app tidak perlu handle "belum pernah setup preferensi" sebagai error
    res.json({ success: true, data: rows[0] || { user_id: req.user.id, interests: [], dislikes: [], styles: [] } });
  } catch (e) {
    console.error('Get preferences error:', e);
    res.status(500).json({ success: false, message: 'Gagal mengambil preferensi' });
  }
};

// PUT /api/preferences — user set manual lewat halaman profile
// (eksplisit, beda dari extractPreferencesFromChat yang implisit dari chat)
const updatePreferences = async (req, res) => {
  try {
    const { budgetMin, budgetMax, preferredGroupType, minStarRating, interests, dislikes, styles } = req.body;

    const normalized = normalizeStyles(styles);
    if (normalized?.error)
      return res.status(400).json({ success: false, message: normalized.error });

    await pool.query(
      `INSERT INTO user_preferences (user_id, budget_min, budget_max, preferred_group_type, min_star_rating, interests, dislikes, styles, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         budget_min = COALESCE(EXCLUDED.budget_min, user_preferences.budget_min),
         budget_max = COALESCE(EXCLUDED.budget_max, user_preferences.budget_max),
         preferred_group_type = COALESCE(EXCLUDED.preferred_group_type, user_preferences.preferred_group_type),
         min_star_rating = COALESCE(EXCLUDED.min_star_rating, user_preferences.min_star_rating),
         interests = COALESCE(EXCLUDED.interests, user_preferences.interests),
         dislikes = COALESCE(EXCLUDED.dislikes, user_preferences.dislikes),
         styles = COALESCE(EXCLUDED.styles, user_preferences.styles),
         updated_at = NOW()`,
      [req.user.id, budgetMin, budgetMax, preferredGroupType, minStarRating, interests, dislikes, normalized?.value ?? null]
    );

    res.json({ success: true, message: 'Preferensi tersimpan' });
  } catch (e) {
    console.error('Update preferences error:', e);
    res.status(500).json({ success: false, message: 'Gagal menyimpan preferensi' });
  }
};

module.exports = { getPreferences, updatePreferences, ALLOWED_STYLES };
