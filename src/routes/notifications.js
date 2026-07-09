const express = require('express');
const router = express.Router();
const { registerToken, unregisterToken, sendTestNotification } = require('../controllers/notificationsController');
const { authMiddleware } = require('../middleware/auth');

router.post('/register-token', authMiddleware, registerToken);
router.delete('/token', authMiddleware, unregisterToken);
router.post('/test', authMiddleware, sendTestNotification);

module.exports = router;
