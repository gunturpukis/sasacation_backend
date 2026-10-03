// src/routes/payments.js
const express = require('express');
const router = express.Router();
const { getPaymentHistory, getInvoice, refundPayment } = require('../controllers/paymentsController');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, getPaymentHistory);
router.get('/:transactionId/invoice', authMiddleware, getInvoice);
// Refund uang = admin only (keputusan bisnis sensitif + panggil gateway).
router.post('/:transactionId/refund', authMiddleware, adminMiddleware, refundPayment);

module.exports = router;
 