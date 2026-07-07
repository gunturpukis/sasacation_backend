const express = require('express');
const router = express.Router();
const { chat, search, generateDesc, tripPlan } = require('../controllers/aiController');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// Chat — optional auth (personalisasi jika login)
router.post('/chat', (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    authMiddleware(req, res, (err) => next());
  } else {
    next();
  }
}, chat);

// Smart search — public, RAG-powered
router.post('/search', search);

// Generate description — admin only, RAG-assisted untuk konsistensi gaya
router.post('/generate-description', authMiddleware, adminMiddleware, generateDesc);

// Trip planner — harus login, RAG multi-query
router.post('/trip-plan', authMiddleware, tripPlan);

module.exports = router;
