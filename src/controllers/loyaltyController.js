// src/controllers/loyaltyController.js
// Loyalty (LOYALTY_DEFINITION.md, disetujui 04 Okt 2026): poin SAJA, bukan
// e-money. Saldo dari loyalty_ledger via loyaltyService (SUM belum
// kedaluwarsa); tier derivasi; trips_completed dari booking sukses.
//
// - GET  /api/loyalty         → pass + poin + tier + expiring + conversion
// - POST /api/loyalty/transfer → { email, points, note? } (atomik, kelipatan 100)
// - GET  /api/loyalty/ledger  → riwayat perolehan/pakai/kedaluwarsa

const pool = require('../config/db');
const loyalty = require('../services/loyaltyService');

function passIdFor(userId) {
  return `SC-${String(userId).replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

// GET /api/loyalty
const getLoyalty = async (req, res) => {
  try {
    const [points, expiring, tRows, uRows] = await Promise.all([
      loyalty.getBalance(pool, req.user.id),
      loyalty.getExpiringSoon(pool, req.user.id),
      pool.query(
        `SELECT COUNT(DISTINCT b.id) AS trips
         FROM bookings b
         JOIN payments p ON p.booking_id = b.id AND p.status = 'success'
         WHERE b.user_id = $1 AND b.status IN ('confirmed','completed')`,
        [req.user.id]
      ),
      pool.query('SELECT created_at FROM users WHERE id = $1', [req.user.id]),
    ]);

    res.json({
      success: true,
      data: {
        pass_id: passIdFor(req.user.id),
        points,
        tier: loyalty.tierFor(points),
        trips_completed: Number(tRows.rows[0]?.trips ?? 0),
        member_since: uRows.rows[0]?.created_at || null,
        points_expiring_soon: expiring,
        conversion: loyalty.conversion(),
      },
    });
  } catch (e) {
    console.error('[loyalty] error:', e.message);
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// POST /api/loyalty/transfer — body { email, points, note? }
const transferLoyalty = async (req, res) => {
  try {
    const { email, points, note } = req.body;
    if (!email || points === undefined)
      return res.status(400).json({ success: false, message: 'email dan points wajib diisi' });
    const pts = Number(points);
    if (!Number.isInteger(pts))
      return res.status(400).json({ success: false, message: 'points harus bilangan bulat' });
    const result = await loyalty.transferPoints(pool, req.user.id, email, pts, note || null);
    const balance = await loyalty.getBalance(pool, req.user.id);
    res.json({ success: true, message: `Transfer ${pts} poin berhasil`, data: { ...result, balance } });
  } catch (e) {
    const status = e.status || 500;
    if (status !== 500) return res.status(status).json({ success: false, message: e.message });
    console.error('[loyalty transfer] error:', e.message);
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// GET /api/loyalty/ledger?limit=
const getLedger = async (req, res) => {
  try {
    const entries = await loyalty.listLedger(pool, req.user.id, req.query.limit);
    res.json({ success: true, data: entries });
  } catch (e) {
    if (e.code === '42P01')
      return res.status(500).json({
        success: false,
        message: 'Tabel loyalty_ledger belum dimigrasi. Jalankan npm run db:migrate:loyalty-ledger',
      });
    console.error('[loyalty ledger] error:', e.message);
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

module.exports = { getLoyalty, transferLoyalty, getLedger, tierFor: loyalty.tierFor };
