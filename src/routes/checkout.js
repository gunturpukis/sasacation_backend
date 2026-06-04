const express = require('express');
const router = express.Router();
const { getPaymentMethods, initiateCheckout, processPayment, getSession } = require('../controllers/checkoutController');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware); // semua checkout butuh login

router.get('/methods', getPaymentMethods);
router.post('/initiate', initiateCheckout);
router.post('/pay', processPayment);
router.get('/session/:sessionId', getSession);

module.exports = router;
