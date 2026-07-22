// src/routes/recommendations.js
const express = require('express');
const router = express.Router();
const { getRecommendations } = require('../controllers/recommendationController');
const { authMiddleware } = require('../middleware/auth');

// Auth optional — pola sama persis dengan /api/ai/chat di routes/ai.js:
// personalisasi kalau login, tetap dapat trending kalau tidak.
router.get('/', (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    authMiddleware(req, res, (err) => next());
  } else {
    next();
  }
}, getRecommendations);

module.exports = router;
