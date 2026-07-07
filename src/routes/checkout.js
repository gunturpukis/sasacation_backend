const express = require('express');
const router = express.Router();
const { getPaymentMethods, initiateCheckout, processPayment } = require('../controllers/checkoutController');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware); // semua checkout wajib login

router.get('/methods', getPaymentMethods);
router.post('/initiate', initiateCheckout);
router.post('/pay', processPayment);

module.exports = router;
