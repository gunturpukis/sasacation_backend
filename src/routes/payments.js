// src/routes/payments.js
const express = require('express');
const router = express.Router();
const { getPaymentHistory } = require('../controllers/paymentsController');
const { authMiddleware } = require('../middleware/auth');
 
router.get('/', authMiddleware, getPaymentHistory);
 
module.exports = router;
 