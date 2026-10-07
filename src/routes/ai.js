const express = require('express');
const router = express.Router();
const { chat, search, generateDesc, tripPlan, compare } = require('../controllers/aiController');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// Optional-auth helper (login → personal, guest → umum, tidak pernah 401)
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    authMiddleware(req, res, () => next());
  } else {
    next();
  }
}

// Chat — optional auth (personalisasi jika login)
router.post('/chat', optionalAuth, chat);

// Smart search — public, RAG-powered (optional auth untuk personalisasi F.1/F.4)
router.post('/search', (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    authMiddleware(req, res, () => next());
  } else {
    next();
  }
}, search);

// F.3 Compare — optional auth (verdict personal bila login)
router.post('/compare', optionalAuth, compare);

// Generate description — admin only, RAG-assisted untuk konsistensi gaya
router.post('/generate-description', authMiddleware, adminMiddleware, generateDesc);

// Trip planner — harus login, RAG multi-query
router.post('/trip-plan', authMiddleware, tripPlan);

module.exports = router;
