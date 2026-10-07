// src/controllers/preferencesController.js
const pool = require('../config/db');

// P5 (FLUTTER_P3_CONTRACTS.md): kosakata gaya travel yang disepakati dengan
// Flutter (kartu preferensi di Settings + ikon per gaya). Disimpan lowercase.
const ALLOWED_STYLES = ['relaxation', 'adventure', 'budget', 'gourmet', 'culture', 'nature', 'luxury'];

// F.4: tier budget turunan — dipakai untuk label "Profil Travel" + ranking search.
const ALLOWED_BUDGET_TIERS = ['budget', 'mid', 'comfort', 'luxury'];

function normalizeStringArray(input, max = 10) {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) return { error: 'harus array string' };
  const clean = [...new Set(
    input.filter(s => typeof s === 'string').map(s => s.trim().toLowerCase()).filter(Boolean)
  )].slice(0, max);
  return { value: clean };
}

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
    const row = rows[0] || {
      user_id: req.user.id, interests: [], dislikes: [], styles: [],
      trip_types: [], amenity_prefs: [], location_prefs: [],
    };
    res.json({ success: true, data: withBudgetTier(row) });
  } catch (e) {
    console.error('Get preferences error:', e);
    res.status(500).json({ success: false, message: 'Gagal mengambil preferensi' });
  }
};

function deriveBudgetTier(prefs) {
  if (prefs?.budget_tier && ALLOWED_BUDGET_TIERS.includes(String(prefs.budget_tier).toLowerCase()))
    return String(prefs.budget_tier).toLowerCase();
  const max = Number(prefs?.budget_max ?? 0);
  if (!max) return null;
  if (max <= 100) return 'budget';
  if (max <= 300) return 'mid';
  if (max <= 800) return 'comfort';
  return 'luxury';
}

function withBudgetTier(row) {
  if (!row) return row;
  return { ...row, budgetTier: deriveBudgetTier(row), budget_tier: row.budget_tier || deriveBudgetTier(row) };
}

// PUT /api/preferences — user set manual lewat halaman profile
// (eksplisit, beda dari extractPreferencesFromChat yang implisit dari chat)
const updatePreferences = async (req, res) => {
  try {
    const { budgetMin, budgetMax, budgetTier, preferredGroupType, minStarRating, interests, dislikes, styles, tripTypes, amenityPrefs, locationPrefs } = req.body;

    const normalized = normalizeStyles(styles);
    if (normalized?.error)
      return res.status(400).json({ success: false, message: normalized.error });

    const tripTypesN = normalizeStringArray(tripTypes);
    if (tripTypesN?.error) return res.status(400).json({ success: false, message: `tripTypes ${tripTypesN.error}` });
    const amenityPrefsN = normalizeStringArray(amenityPrefs);
    if (amenityPrefsN?.error) return res.status(400).json({ success: false, message: `amenityPrefs ${amenityPrefsN.error}` });
    const locationPrefsN = normalizeStringArray(locationPrefs);
    if (locationPrefsN?.error) return res.status(400).json({ success: false, message: `locationPrefs ${locationPrefsN.error}` });

    let tier = budgetTier !== undefined ? String(budgetTier).trim().toLowerCase() : undefined;
    if (tier !== undefined && tier !== '' && !ALLOWED_BUDGET_TIERS.includes(tier))
      return res.status(400).json({ success: false, message: `budgetTier tidak dikenal. Pilih dari: ${ALLOWED_BUDGET_TIERS.join(', ')}` });
    if (tier === '') tier = null;

    await pool.query(
      `INSERT INTO user_preferences (user_id, budget_min, budget_max, budget_tier, preferred_group_type, min_star_rating, interests, dislikes, styles, trip_types, amenity_prefs, location_prefs, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         budget_min = COALESCE(EXCLUDED.budget_min, user_preferences.budget_min),
         budget_max = COALESCE(EXCLUDED.budget_max, user_preferences.budget_max),
         budget_tier = COALESCE(EXCLUDED.budget_tier, user_preferences.budget_tier),
         preferred_group_type = COALESCE(EXCLUDED.preferred_group_type, user_preferences.preferred_group_type),
         min_star_rating = COALESCE(EXCLUDED.min_star_rating, user_preferences.min_star_rating),
         interests = COALESCE(EXCLUDED.interests, user_preferences.interests),
         dislikes = COALESCE(EXCLUDED.dislikes, user_preferences.dislikes),
         styles = COALESCE(EXCLUDED.styles, user_preferences.styles),
         trip_types = COALESCE(EXCLUDED.trip_types, user_preferences.trip_types),
         amenity_prefs = COALESCE(EXCLUDED.amenity_prefs, user_preferences.amenity_prefs),
         location_prefs = COALESCE(EXCLUDED.location_prefs, user_preferences.location_prefs),
         updated_at = NOW()`,
      [req.user.id, budgetMin, budgetMax, tier ?? null, preferredGroupType, minStarRating, interests, dislikes, normalized?.value ?? null, tripTypesN?.value ?? null, amenityPrefsN?.value ?? null, locationPrefsN?.value ?? null]
    );

    res.json({ success: true, message: 'Preferensi tersimpan' });
  } catch (e) {
    // Kolom belum dimigrasi di DB lama → pesan jelas, bukan 500 misterius
    if (e.code === '42703') return res.status(500).json({ success: false, message: 'Kolom profil belum dimigrasi. Jalankan npm run db:migrate:profile-ext' });
    console.error('Update preferences error:', e);
    res.status(500).json({ success: false, message: 'Gagal menyimpan preferensi' });
  }
};

// GET /api/preferences/profile — agregat "Profil Travel" (F.4):
// prefs + statistik wishlist/booking + derived budgetTier.
// Dipakai Home "Paling cocok untuk kamu" + personalisasi search/compare.
const getProfile = async (req, res) => {
  try {
    const [prefsResult, wishlistResult, bookingResult] = await Promise.all([
      pool.query('SELECT * FROM user_preferences WHERE user_id = $1', [req.user.id]).catch((e) => {
        if (e.code === '42703') return { rows: [] }; // kolom baru belum ada → fallback prefs kosong
        throw e;
      }),
      pool.query('SELECT COUNT(*) AS c FROM wishlist WHERE user_id = $1', [req.user.id]).catch(() => ({ rows: [{ c: 0 }] })),
      pool.query("SELECT COUNT(*) AS c FROM bookings WHERE user_id = $1 AND status != 'cancelled'", [req.user.id]).catch(() => ({ rows: [{ c: 0 }] })),
    ]);
    const prefs = withBudgetTier(prefsResult.rows[0] || {
      user_id: req.user.id, interests: [], dislikes: [], styles: [],
      trip_types: [], amenity_prefs: [], location_prefs: [],
    });
    res.json({
      success: true,
      data: {
        ...prefs,
        travelStyles: prefs.styles || [],
        tripTypes: prefs.trip_types || [],
        amenityPrefs: prefs.amenity_prefs || [],
        locationPrefs: prefs.location_prefs || [],
        stats: {
          wishlistCount: Number(wishlistResult.rows[0]?.c || 0),
          bookingCount: Number(bookingResult.rows[0]?.c || 0),
        },
      },
    });
  } catch (e) {
    console.error('Get profile error:', e);
    res.status(500).json({ success: false, message: 'Gagal mengambil profil travel' });
  }
};

module.exports = { getPreferences, updatePreferences, getProfile, ALLOWED_STYLES, ALLOWED_BUDGET_TIERS };
