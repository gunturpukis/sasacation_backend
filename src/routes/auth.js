const express = require('express');
const router = express.Router();
const { register, login, socialLogin, getMe, updateProfile } = require('../controllers/authController');
const { authMiddleware } = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);
router.post('/social', socialLogin);   // Google & Apple
router.get('/me', authMiddleware, getMe);
router.put('/profile', authMiddleware, updateProfile);

module.exports = router;
