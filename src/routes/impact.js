// src/routes/impact.js
const express = require('express');
const router = express.Router();
const { getSummary, getDiscovery } = require('../controllers/impactController');
const { authMiddleware } = require('../middleware/auth');

// Auth optional — pola sama dengan /api/recommendations: login → personal,
// guest → zero-state (summary) / rekomendasi umum (discovery). Tidak pernah 401.
function optionalAuth(req, res, next) {
  if (req.headers.authorization?.startsWith('Bearer ')) {
    authMiddleware(req, res, () => next());
  } else {
    next();
  }
}

router.get('/summary', optionalAuth, getSummary);
router.get('/discovery', optionalAuth, getDiscovery);

module.exports = router;
