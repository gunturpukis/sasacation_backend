const express = require('express');
const router = express.Router();
const { getHotels, getHotelById, getNearbyHotels } = require('../controllers/hotelsController');

router.get('/', getHotels);
router.get('/nearby', getNearbyHotels); // HARUS sebelum /:id, kalau tidak "nearby" akan tertangkap sebagai :id
router.get('/:id', getHotelById);

module.exports = router;
