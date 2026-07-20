// src/routes/chatSessions.js
const express = require('express');
const router = express.Router();
const { getLatestSession } = require('../controllers/chatSessionController');
const { authMiddleware } = require('../middleware/auth');

// Wajib login — riwayat chat melekat ke user_id, tidak ada konsep guest history
router.get('/latest', authMiddleware, getLatestSession);

module.exports = router;
