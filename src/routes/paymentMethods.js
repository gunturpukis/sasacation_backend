// src/routes/paymentMethods.js
const express = require('express');
const router = express.Router();
const { listMethods, setPrimary, removeMethod, renameMethod } = require('../controllers/paymentMethodsController');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware); // semua vault wajib login

router.get('/', listMethods);
router.patch('/:id/primary', setPrimary);
router.patch('/:id', renameMethod); // B4: julukan kartu
router.delete('/:id', removeMethod);

module.exports = router;
