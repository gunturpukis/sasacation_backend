// src/controllers/recommendationController.js
const { getPersonalizedRecommendations, getTrendingHotels } = require('../services/recommendationService');

// GET /api/recommendations
// Auth optional (sama seperti /api/ai/chat): login → personalized,
// guest → trending. Dua-duanya tetap balikin data, tidak pernah 401,
// supaya bagian "Recommended for you" di Home tidak perlu logic
// show/hide berdasarkan status login di sisi app.
const getRecommendations = async (req, res) => {
  try {
    const topK = req.query.limit ? parseInt(req.query.limit, 10) : undefined;

    const hotels = req.user?.id
      ? await getPersonalizedRecommendations(req.user.id, topK)
      : await getTrendingHotels([], topK);

    res.json({ success: true, data: hotels });
  } catch (e) {
    console.error('Get recommendations error:', e);
    res.status(500).json({ success: false, message: 'Gagal mengambil rekomendasi' });
  }
};

module.exports = { getRecommendations };
