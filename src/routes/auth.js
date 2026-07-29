// const express = require('express');
// const router = express.Router();
// const { register, login, socialLogin, firebaseLogin, getMe, updateProfile, updateLocation } = require('../controllers/authController');
// const { authMiddleware } = require('../middleware/auth');

// router.post('/register', register);
// router.post('/login', login);
// router.post('/social', socialLogin); // deprecated: tidak verifikasi provider, dipertahankan untuk kompatibilitas lama
// router.post('/firebase', firebaseLogin); // rekomendasi: login via Firebase Auth (idToken diverifikasi)
// router.get('/me', authMiddleware, getMe);
// router.put('/profile', authMiddleware, updateProfile);
// router.patch('/location', authMiddleware, updateLocation);

// module.exports = router;

const express = require('express');
const router = express.Router();
const { register, login, firebaseLogin, getMe, updateProfile, updateLocation } = require('../controllers/authController');
const { authMiddleware } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimiter');
 
router.post('/register', register);
router.post('/login', loginLimiter, login);
// FIX KEAMANAN KRITIS: endpoint /social DINONAKTIFKAN.
// Endpoint ini menerima {provider, providerId, email} APA ADANYA dari body
// request tanpa verifikasi sama sekali ke provider OAuth sungguhan — artinya
// SIAPA PUN yang tahu email seseorang bisa POST ke sini dengan email itu,
// dan server akan mencari/membuat user dengan email tersebut, meng-update
// provider_id-nya, lalu MENGELUARKAN JWT VALID untuk akun itu. Ini account
// takeover: penyerang tidak perlu password korban sama sekali, cukup email-nya.
//
// Dikonfirmasi app sasacation_app SUDAH TIDAK memanggil endpoint ini sama
// sekali (sudah pindah ke /firebase yang benar-benar verifikasi idToken
// lewat Firebase Admin SDK) — jadi menonaktifkan ini TIDAK berdampak fungsi
// apa pun. Kalau suatu saat memang butuh social login tanpa Firebase lagi,
// endpoint ini harus ditulis ulang untuk verifikasi token asli ke provider
// (Google/Apple token verification API), BUKAN dipakai lagi apa adanya.
// router.post('/social', socialLogin);
router.post('/firebase', firebaseLogin); // rekomendasi: login via Firebase Auth (idToken diverifikasi)
router.get('/me', authMiddleware, getMe);
router.put('/profile', authMiddleware, updateProfile);
router.patch('/location', authMiddleware, updateLocation);
 
module.exports = router;
 







