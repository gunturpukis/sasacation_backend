// src/routes/loyalty.js
const express = require('express');
const router = express.Router();
const { getLoyalty } = require('../controllers/loyaltyController');
const { authMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, getLoyalty);

module.exports = router;
