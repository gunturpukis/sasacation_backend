const express = require('express');
const router = express.Router();
const { getMyBookings, getBookingById, cancelBooking, getAllBookings, rescheduleBooking, closePastBookings } = require('../controllers/bookingsController');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

router.use(authMiddleware); // semua booking wajib login

router.get('/my', getMyBookings);
router.post('/close-past', closePastBookings); // HARUS sebelum /:id
router.get('/', adminMiddleware, getAllBookings);
router.get('/:id', getBookingById);
router.patch('/:id/cancel', cancelBooking);
router.patch('/:id/reschedule', rescheduleBooking); // A4

// NOTE: booking baru HANYA dibuat lewat /api/checkout/pay,
// supaya setiap booking pasti punya payment yang menyertainya

module.exports = router;
