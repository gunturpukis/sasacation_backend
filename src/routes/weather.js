// src/routes/weather.js
const express = require('express');
const router = express.Router();
const { getWeather } = require('../controllers/weatherController');

// Publik — cuaca destinasi tampil untuk guest maupun user login.
router.get('/', getWeather);

module.exports = router;
