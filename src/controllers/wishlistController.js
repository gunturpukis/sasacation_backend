// src/controllers/wishlistController.js
const pool = require('../config/db');

// GET /api/wishlist — daftar hotel_id yang di-wishlist user
const getWishlist = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT h.id, h.name, h.location, h.price, h.rating, h.image
       FROM wishlist w
       JOIN hotels h ON h.id = w.hotel_id
       WHERE w.user_id = $1
       ORDER BY w.created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error('Get wishlist error:', e);
    res.status(500).json({ success: false, message: 'Gagal mengambil wishlist' });
  }
};

// POST /api/wishlist/toggle { hotelId } — toggle, idempotent
const toggleWishlist = async (req, res) => {
  try {
    const { hotelId } = req.body;
    if (!hotelId) return res.status(400).json({ success: false, message: 'hotelId wajib diisi' });

    const existing = await pool.query(
      'SELECT id FROM wishlist WHERE user_id = $1 AND hotel_id = $2',
      [req.user.id, hotelId]
    );

    if (existing.rows.length > 0) {
      await pool.query('DELETE FROM wishlist WHERE id = $1', [existing.rows[0].id]);
      return res.json({ success: true, data: { saved: false } });
    }

    await pool.query(
      'INSERT INTO wishlist (user_id, hotel_id) VALUES ($1, $2)',
      [req.user.id, hotelId]
    );
    res.json({ success: true, data: { saved: true } });
  } catch (e) {
    console.error('Toggle wishlist error:', e);
    res.status(500).json({ success: false, message: 'Gagal update wishlist' });
  }
};

module.exports = { getWishlist, toggleWishlist };
