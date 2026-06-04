const express = require('express');
const router = express.Router();
const { chat, search, generateDesc, tripPlan } = require('../controllers/aiController');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// Chat - optional auth (personalisasi jika login)
router.post('/chat', (req, res, next) => {
  // Coba attach user jika ada token, tapi tidak wajib
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    authMiddleware(req, res, (err) => {
      if (err) return next(); // lanjut tanpa user
      next();
    });
  } else {
    next();
  }
}, chat);

// Smart search - public
router.post('/search', search);

// Generate description - admin only
router.post('/generate-description', authMiddleware, adminMiddleware, generateDesc);

// Trip planner - harus login
router.post('/trip-plan', authMiddleware, tripPlan);

module.exports = router;
