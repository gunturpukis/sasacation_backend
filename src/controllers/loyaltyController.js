// src/controllers/loyaltyController.js
// A6 (audit Figma: kartu "Travel Pass Premium / Sasacation Gold" + "Gold
// Member • 12 Trips" di profil).
//
// Tier dihitung DERIVASI (tidak ada tabel baru):
//   - points: loyalty_points (1 poin per $1 top-up sukses, lihat P2)
//   - tier: Bronze <100, Silver 100–499, Gold 500–1999, Platinum 2000+
//   - trips_completed: booking confirmed/completed dengan payment sukses
//   - pass_id: ID member stabil derivasi UUID (bukan nomor kartu bank —
//     kartu fisik/virtual Travel Pass bukan artefact backend)

const pool = require('../config/db');

function tierFor(points) {
  if (points >= 2000) return 'Platinum';
  if (points >= 500) return 'Gold';
  if (points >= 100) return 'Silver';
  return 'Bronze';
}

// GET /api/loyalty
const getLoyalty = async (req, res) => {
  try {
    const [{ rows: pRows }, { rows: tRows }, { rows: uRows }] = await Promise.all([
      pool.query('SELECT points FROM loyalty_points WHERE user_id = $1', [req.user.id]),
      pool.query(
        `SELECT COUNT(DISTINCT b.id) AS trips
         FROM bookings b
         JOIN payments p ON p.booking_id = b.id AND p.status = 'success'
         WHERE b.user_id = $1 AND b.status IN ('confirmed','completed')`,
        [req.user.id]
      ),
      pool.query('SELECT created_at FROM users WHERE id = $1', [req.user.id]),
    ]);

    const points = Number(pRows[0]?.points ?? 0);
    const trips = Number(tRows[0]?.trips ?? 0);
    const passId = `SC-${req.user.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

    res.json({
      success: true,
      data: {
        pass_id: passId,
        points,
        tier: tierFor(points),
        trips_completed: trips,
        member_since: uRows[0]?.created_at || null,
      },
    });
  } catch (e) {
    console.error('[loyalty] error:', e.message);
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

module.exports = { getLoyalty, tierFor };
