// src/controllers/recommendationController.js
const pool = require('../config/db');
const { getPersonalizedRecommendations, getTrendingHotels } = require('../services/recommendationService');

// F.4: bangun profil traveler terstruktur dari preferences + aktivitas.
// Dipakai FE untuk kartu "Profil Travel" + label "Paling cocok untuk kamu".
// Fail-soft (null) supaya rekomendasi tetap jalan walau tabel belum ada.
async function buildTravelerProfile(userId) {
  if (!userId) return null;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM user_preferences WHERE user_id = $1',
      [userId]
    );
    const prefs = rows[0];
    if (!prefs) return null;
    const tier = prefs.budget_tier || (prefs.budget_max == null
      ? null
      : prefs.budget_max <= 100 ? 'budget' : prefs.budget_max <= 300 ? 'mid' : prefs.budget_max <= 800 ? 'comfort' : 'luxury');
    return {
      budgetTier: tier,
      budgetMin: prefs.budget_min,
      budgetMax: prefs.budget_max,
      travelStyles: prefs.styles || [],
      tripTypes: prefs.trip_types?.length ? prefs.trip_types : (prefs.preferred_group_type ? [prefs.preferred_group_type] : []),
      amenityPrefs: prefs.amenity_prefs || [],
      locationPrefs: prefs.location_prefs || [],
      styles: prefs.styles || [],
      interests: prefs.interests || [],
      dislikes: prefs.dislikes || [],
      minStarRating: prefs.min_star_rating,
    };
  } catch (e) {
    console.error('[profile] buildTravelerProfile gagal (fail-soft):', e.message);
    return null;
  }
}

// GET /api/recommendations
// Auth optional (sama seperti /api/ai/chat): login → personalized,
// guest → trending. Dua-duanya tetap balikin data, tidak pernah 401,
// supaya bagian "Recommended for you" di Home tidak perlu logic
// show/hide berdasarkan status login di sisi app.
//
// F.4: response tambah `profile` (null untuk guest / user baru) —
// field `data` TETAP array hotel (backward compatible dengan FE lama).
const getRecommendations = async (req, res) => {
  try {
    const topK = req.query.limit ? parseInt(req.query.limit, 10) : undefined;

    const hotels = req.user?.id
      ? await getPersonalizedRecommendations(req.user.id, topK)
      : await getTrendingHotels([], topK);

    const profile = await buildTravelerProfile(req.user?.id);

    res.json({ success: true, data: hotels, profile });
  } catch (e) {
    console.error('Get recommendations error:', e);
    res.status(500).json({ success: false, message: 'Gagal mengambil rekomendasi' });
  }
};

module.exports = { getRecommendations, buildTravelerProfile };
