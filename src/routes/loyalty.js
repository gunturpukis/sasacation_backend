// src/routes/loyalty.js
const express = require('express');
const router = express.Router();
const { getLoyalty, transferLoyalty, getLedger } = require('../controllers/loyaltyController');
const { authMiddleware } = require('../middleware/auth');
const { moneyLimiter } = require('../middleware/rateLimiter');

router.get('/', authMiddleware, getLoyalty);
router.get('/ledger', authMiddleware, getLedger);
router.post('/transfer', authMiddleware, moneyLimiter, transferLoyalty);

module.exports = router;
