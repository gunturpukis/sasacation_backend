// const express = require('express');
// const router = express.Router();
// const { getPaymentMethods, initiateCheckout, processPayment } = require('../controllers/checkoutController');
// const { authMiddleware } = require('../middleware/auth');

// router.use(authMiddleware); // semua checkout wajib login

// router.get('/methods', getPaymentMethods);
// router.post('/initiate', initiateCheckout);
// router.post('/pay', processPayment);

// module.exports = router;
const express = require('express');
const router = express.Router();
const { getPaymentMethods, initiateCheckout, processPayment, handleMidtransWebhook, getPaymentStatus } = require('../controllers/checkoutController');
const { authMiddleware } = require('../middleware/auth');

// PENTING: webhook Midtrans dipanggil server-ke-server, TIDAK membawa token
// JWT user — harus didaftarkan SEBELUM router.use(authMiddleware) di bawah,
// kalau tidak endpoint ini akan ikut ke-block dan Midtrans tidak pernah bisa
// mengonfirmasi status pembayaran ke kita.
router.post('/webhook/midtrans', handleMidtransWebhook);

router.use(authMiddleware); // semua checkout wajib login

router.get('/methods', getPaymentMethods);
router.post('/initiate', initiateCheckout);
router.post('/pay', processPayment);
router.get('/status/:transactionId', getPaymentStatus);

module.exports = router;