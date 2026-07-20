// src/routes/wishlist.js
const express = require('express');
const router = express.Router();
const { getWishlist, toggleWishlist } = require('../controllers/wishlistController');
const { authMiddleware } = require('../middleware/auth');

// Semua endpoint wishlist wajib login — datanya melekat ke user_id
router.get('/', authMiddleware, getWishlist);
router.post('/toggle', authMiddleware, toggleWishlist);

module.exports = router;
