// src/routes/wallet.js
const express = require('express');
const router = express.Router();
const {
  getWallet, getTransactions, topup, handleWalletWebhook, spend, transfer,
} = require('../controllers/walletController');
const { authMiddleware } = require('../middleware/auth');

// PENTING: sama seperti checkout — webhook Midtrans dipanggil server-ke-server
// TANPA token JWT, jadi harus didaftarkan SEBELUM router.use(authMiddleware).
router.post('/webhook/midtrans', handleWalletWebhook);

router.use(authMiddleware); // semua endpoint wallet (kecuali webhook) wajib login

router.get('/', getWallet);
router.get('/transactions', getTransactions);
router.post('/topup', topup);
router.post('/spend', spend);
router.post('/transfer', transfer); // A6

module.exports = router;
