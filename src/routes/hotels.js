const express = require('express');
const router = express.Router();
const {
  getHotels, getHotelById, getHotelReviews, getReviewSummary, getNearbyHotels,
  getMyHotels, createHotel, updateHotel, deleteHotel,
} = require('../controllers/hotelsController');
const { authMiddleware, partnerMiddleware } = require('../middleware/auth');

// Auth optional — pola sama dengan impact.js/recommendations: login → personal,
// guest → umum. Tidak pernah 401.
function optionalAuth(req, res, next) {
  if (req.headers.authorization?.startsWith('Bearer ')) {
    authMiddleware(req, res, () => next());
  } else {
    next();
  }
}

// ─── Publik (guest browsing, sesuai rekomendasi BA) ────────────────────────
router.get('/', getHotels);
router.get('/nearby', getNearbyHotels); // HARUS sebelum /:id, kalau tidak "nearby" akan tertangkap sebagai :id
router.get('/my', authMiddleware, partnerMiddleware, getMyHotels); // HARUS sebelum /:id juga
// F.2: HARUS sebelum /:id agar "abc/reviews" tidak tertangkap sebagai :id="abc/reviews"
router.get('/:id/reviews', getHotelReviews);
router.get('/:id/review-summary', optionalAuth, getReviewSummary);
router.get('/:id', getHotelById);

// ─── Mitra (partner) / admin — kelola hotel milik sendiri ──────────────────
router.post('/', authMiddleware, partnerMiddleware, createHotel);
router.put('/:id', authMiddleware, partnerMiddleware, updateHotel);
router.delete('/:id', authMiddleware, partnerMiddleware, deleteHotel);

module.exports = router;
