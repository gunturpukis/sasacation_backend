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

// PATCH /api/bookings/:id/reschedule — body { checkIn, checkOut }
// A4 (tombol "Reschedule" Figma): geser tanggal booking 'confirmed' milik
// sendiri. Harga dihitung ulang dengan rumus checkout yang sama; selisihnya
// dikembalikan (price_diff > 0 = user perlu bayar tambahan via /pay baru,
// < 0 = kelebihan — refund manual/otomatis BELUM diotomatiskan, tercatat
// sebagai informasi).
const rescheduleBooking = async (req, res) => {
  const client = await pool.connect();
  try {
    const { checkIn, checkOut } = req.body;
    if (!checkIn || !checkOut)
      return res.status(400).json({ success: false, message: 'checkIn dan checkOut wajib diisi' });

    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);
    const nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
    if (!nights || nights <= 0)
      return res.status(400).json({ success: false, message: 'Tanggal checkout harus setelah checkin' });

    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT b.*, h.price AS hotel_price, h.cleaning_fee FROM bookings b
       JOIN hotels h ON h.id = b.hotel_id WHERE b.id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Booking tidak ditemukan' });
    }
    const booking = rows[0];
    if (booking.user_id !== req.user.id && req.user.role !== 'admin') {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }
    if (booking.status !== 'confirmed') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Hanya booking confirmed yang bisa dijadwalkan ulang' });
    }

    const overlap = await client.query(
      `SELECT id FROM bookings
       WHERE hotel_id = $1 AND id <> $2 AND status IN ('pending','confirmed')
         AND check_in < $4 AND check_out > $3`,
      [booking.hotel_id, booking.id, checkInDate, checkOutDate]
    );
    if (overlap.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'Tanggal baru bentrok dengan booking lain' });
    }

    const pricePerNight = Number(booking.hotel_price);
    const subtotal = pricePerNight * nights;
    const newTotal = subtotal + Math.round(subtotal * 0.11) + 15 + (Number(booking.cleaning_fee) || 0);
    const oldTotal = Number(booking.total_price);

    const { rows: updated } = await client.query(
      `UPDATE bookings SET check_in = $1, check_out = $2, nights = $3,
         price_per_night = $4, total_price = $5, updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [checkInDate, checkOutDate, nights, pricePerNight, newTotal, booking.id]
    );
    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Jadwal booking diperbarui',
      data: {
        booking: updated[0],
        old_total: oldTotal,
        new_total: newTotal,
        price_diff: newTotal - oldTotal,
      },
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  } finally {
    client.release();
  }
};

module.exports = { getMyBookings, getBookingById, cancelBooking, getAllBookings, rescheduleBooking };
