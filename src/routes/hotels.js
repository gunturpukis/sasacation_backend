const express = require('express');
const router = express.Router();
const {
  getHotels, getHotelById, getNearbyHotels,
  getMyHotels, createHotel, updateHotel, deleteHotel,
} = require('../controllers/hotelsController');
const { authMiddleware, partnerMiddleware } = require('../middleware/auth');

// ─── Publik (guest browsing, sesuai rekomendasi BA) ────────────────────────
router.get('/', getHotels);
router.get('/nearby', getNearbyHotels); // HARUS sebelum /:id, kalau tidak "nearby" akan tertangkap sebagai :id
router.get('/my', authMiddleware, partnerMiddleware, getMyHotels); // HARUS sebelum /:id juga
router.get('/:id', getHotelById);

// ─── Mitra (partner) / admin — kelola hotel milik sendiri ──────────────────
router.post('/', authMiddleware, partnerMiddleware, createHotel);
router.put('/:id', authMiddleware, partnerMiddleware, updateHotel);
router.delete('/:id', authMiddleware, partnerMiddleware, deleteHotel);

module.exports = router;
