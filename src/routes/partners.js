const express = require('express');
const router = express.Router();
const {
  applyForPartner,
  getMyProperty,
  updateMyProperty,
  listPartnerApplications,
  approvePartner,
  rejectPartner,
} = require('../controllers/partnersController');
const { authMiddleware, adminMiddleware, partnerMiddleware } = require('../middleware/auth');

router.use(authMiddleware); // semua endpoint di sini wajib login

// ─── Self-service (user biasa yang mengajukan / partner yang sudah verified)
router.post('/apply', applyForPartner);
router.get('/me', getMyProperty);
router.put('/me', partnerMiddleware, updateMyProperty); // update cuma untuk yang sudah verified

// ─── Admin oversight ────────────────────────────────────────────────────────
router.get('/admin/all', adminMiddleware, listPartnerApplications);
router.patch('/admin/:id/approve', adminMiddleware, approvePartner);
router.patch('/admin/:id/reject', adminMiddleware, rejectPartner);

module.exports = router;
