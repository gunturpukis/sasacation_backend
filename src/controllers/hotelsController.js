const pool = require('../config/db');

const getHotels = async (req, res) => {
  try {
    const { featured, search, minPrice, maxPrice, page = 1, limit = 10 } = req.query;
    const conditions = ['available = true'];
    const params = [];

    if (featured === 'true') conditions.push('featured = true');
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(name ILIKE $${params.length} OR location ILIKE $${params.length})`);
    }
    if (minPrice) { params.push(Number(minPrice)); conditions.push(`price >= $${params.length}`); }
    if (maxPrice) { params.push(Number(maxPrice)); conditions.push(`price <= $${params.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await pool.query(`SELECT COUNT(*) FROM hotels ${where}`, params);
    const total = Number(countResult.rows[0].count);

    params.push(Number(limit), (Number(page) - 1) * Number(limit));
    const { rows } = await pool.query(
      `SELECT * FROM hotels ${where} ORDER BY featured DESC, rating DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ success: true, data: rows, meta: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

const getHotelById = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM hotels WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Hotel tidak ditemukan' });
    res.json({ success: true, data: rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

module.exports = { getHotels, getHotelById };
