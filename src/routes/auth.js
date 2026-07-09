const express = require('express');
const router = express.Router();
const { register, login, socialLogin, firebaseLogin, getMe, updateProfile, updateLocation } = require('../controllers/authController');
const { authMiddleware } = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);
router.post('/social', socialLogin); // deprecated: tidak verifikasi provider, dipertahankan untuk kompatibilitas lama
router.post('/firebase', firebaseLogin); // rekomendasi: login via Firebase Auth (idToken diverifikasi)
router.get('/me', authMiddleware, getMe);
router.put('/profile', authMiddleware, updateProfile);
router.patch('/location', authMiddleware, updateLocation);

module.exports = router;
