// src/routes/settings.js
const express = require('express');
const router = express.Router();
const { getSettings, updateSettings } = require('../controllers/settingsController');
const { authMiddleware } = require('../middleware/auth');

router.get('/', authMiddleware, getSettings);
router.put('/', authMiddleware, updateSettings);

module.exports = router;
