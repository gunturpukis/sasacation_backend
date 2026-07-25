// const express = require('express');
// const router = express.Router();
// const { registerToken, unregisterToken, sendTestNotification } = require('../controllers/notificationsController');
// const { authMiddleware } = require('../middleware/auth');

// router.post('/register-token', authMiddleware, registerToken);
// router.delete('/token', authMiddleware, unregisterToken);
// router.post('/test', authMiddleware, sendTestNotification);

// module.exports = router;
const express = require('express');
const router = express.Router();
const { registerToken, unregisterToken, sendTestNotification, getNotifications, markAsRead } = require('../controllers/notificationsController');
const { authMiddleware } = require('../middleware/auth');
 
router.get('/', authMiddleware, getNotifications);
router.patch('/:id/read', authMiddleware, markAsRead);
router.post('/register-token', authMiddleware, registerToken);
router.delete('/token', authMiddleware, unregisterToken);
router.post('/test', authMiddleware, sendTestNotification);
 
module.exports = router;
 