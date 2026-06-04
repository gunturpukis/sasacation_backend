const express = require('express');
const router = express.Router();
const { getHotels, getHotelById, createHotel, updateHotel, deleteHotel } = require('../controllers/hotelsController');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

router.get('/', getHotels);
router.get('/:id', getHotelById);
router.post('/', authMiddleware, adminMiddleware, createHotel);
router.put('/:id', authMiddleware, adminMiddleware, updateHotel);
router.delete('/:id', authMiddleware, adminMiddleware, deleteHotel);

module.exports = router;
