const pool = require('../config/db');

// GET /api/bookings/my — booking milik user yang login, JOIN dengan hotel
const getMyBookings = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        b.*,
        json_build_object(
          'id', h.id, 'name', h.name, 'location', h.location,
          'image', h.image, 'rating', h.rating
        ) AS hotel,
        json_build_object(
          'transactionId', p.transaction_id, 'method', p.method,
          'status', p.status, 'paidAt', p.paid_at
        ) AS payment
      FROM bookings b
      JOIN hotels h ON h.id = b.hotel_id
      LEFT JOIN payments p ON p.booking_id = b.id
      WHERE b.user_id = $1
      ORDER BY b.created_at DESC
    `, [req.user.id]);

    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// GET /api/bookings/:id
const getBookingById = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT b.*, json_build_object('id', h.id, 'name', h.name, 'location', h.location, 'image', h.image) AS hotel
      FROM bookings b JOIN hotels h ON h.id = b.hotel_id
      WHERE b.id = $1
    `, [req.params.id]);

    if (rows.length === 0)
      return res.status(404).json({ success: false, message: 'Booking tidak ditemukan' });

    const booking = rows[0];
    if (booking.user_id !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ success: false, message: 'Akses ditolak' });

    res.json({ success: true, data: booking });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// PATCH /api/bookings/:id/cancel
const cancelBooking = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    if (rows.length === 0)
      return res.status(404).json({ success: false, message: 'Booking tidak ditemukan' });

    const booking = rows[0];
    if (booking.user_id !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    if (booking.status === 'cancelled')
      return res.status(400).json({ success: false, message: 'Booking sudah dibatalkan' });

    const updated = await pool.query(
      `UPDATE bookings SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    res.json({ success: true, message: 'Booking berhasil dibatalkan', data: updated.rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// GET /api/bookings (admin) — semua booking, dengan filter status opsional
const getAllBookings = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const params = [];
    let where = '';
    if (status) { params.push(status); where = `WHERE b.status = $${params.length}`; }

    const countResult = await pool.query(`SELECT COUNT(*) FROM bookings b ${where}`, params);
    const total = Number(countResult.rows[0].count);

    params.push(Number(limit), (Number(page) - 1) * Number(limit));
    const { rows } = await pool.query(`
      SELECT
        b.*,
        json_build_object('name', u.name, 'email', u.email) AS user,
        json_build_object('id', h.id, 'name', h.name, 'location', h.location) AS hotel
      FROM bookings b
      JOIN users u ON u.id = b.user_id
      JOIN hotels h ON h.id = b.hotel_id
      ${where}
      ORDER BY b.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({
      success: true, data: rows,
      meta: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

module.exports = { getMyBookings, getBookingById, cancelBooking, getAllBookings };
