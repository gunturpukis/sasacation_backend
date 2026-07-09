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

// GET /api/hotels/nearby?lat=&lng=&radius=10&limit=20
// Hotel terdekat dari koordinat yang dikirim (biasanya lokasi GPS user saat ini).
// Jarak dihitung dengan formula Haversine langsung di SQL (dalam kilometer),
// hanya hotel yang punya latitude/longitude yang ikut dihitung.
const getNearbyHotels = async (req, res) => {
  try {
    const { lat, lng, radius = 25, limit = 20 } = req.query;
    if (lat === undefined || lng === undefined)
      return res.status(400).json({ success: false, message: 'lat dan lng wajib diisi' });

    const latitude = Number(lat);
    const longitude = Number(lng);
    const radiusKm = Number(radius);
    if (Number.isNaN(latitude) || Number.isNaN(longitude))
      return res.status(400).json({ success: false, message: 'lat dan lng harus berupa angka' });

    const { rows } = await pool.query(
      `
      SELECT *, distance_km FROM (
        SELECT *,
          (
            6371 * acos(
              LEAST(1, GREATEST(-1,
                cos(radians($1)) * cos(radians(latitude)) *
                cos(radians(longitude) - radians($2)) +
                sin(radians($1)) * sin(radians(latitude))
              ))
            )
          ) AS distance_km
        FROM hotels
        WHERE available = true AND latitude IS NOT NULL AND longitude IS NOT NULL
      ) sub
      WHERE distance_km <= $3
      ORDER BY distance_km ASC
      LIMIT $4
      `,
      [latitude, longitude, radiusKm, Number(limit)]
    );

    res.json({ success: true, data: rows, meta: { lat: latitude, lng: longitude, radiusKm } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

module.exports = { getHotels, getHotelById, getNearbyHotels };
