const express = require('express');
const router = express.Router();
const { getMyBookings, getBookingById, cancelBooking, getAllBookings } = require('../controllers/bookingsController');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

router.get('/my', getMyBookings);
router.get('/', adminMiddleware, getAllBookings);
router.get('/:id', getBookingById);
router.patch('/:id/cancel', cancelBooking);

// NOTE: POST (create booking) sekarang hanya melalui /api/checkout/pay
// untuk memastikan semua booking melewati payment flow

module.exports = router;
