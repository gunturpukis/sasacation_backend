const pool = require('../config/db');

// GET /api/explore — gabungan hotel + destinasi + restoran
const getExplore = async (req, res) => {
  try {
    const { category, search } = req.query;
    const cat = category?.toLowerCase();
    const searchParam = search ? `%${search}%` : null;

    let hotels = [], destinations = [], restaurants = [];

    if (!cat || cat === 'all' || cat === 'hotels') {
      const params = searchParam ? [searchParam] : [];
      const where = searchParam ? 'WHERE name ILIKE $1' : '';
      const { rows } = await pool.query(`SELECT * FROM hotels ${where} ORDER BY rating DESC`, params);
      hotels = rows.map(h => ({ ...h, category: 'Hotels', type: 'hotel' }));
    }

    if (!cat || cat === 'all' || cat === 'destinations' || ['beaches','islands','adventure','culture'].includes(cat)) {
      const subCatMap = { beaches: 'Beaches', islands: 'Islands', adventure: 'Adventure', culture: 'Culture' };
      const params = [];
      const conditions = [];
      if (searchParam) { params.push(searchParam); conditions.push(`name ILIKE $${params.length}`); }
      if (subCatMap[cat]) { params.push(subCatMap[cat]); conditions.push(`sub_category = $${params.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM destinations ${where} ORDER BY rating DESC`, params);
      destinations = rows.map(d => ({ ...d, category: 'Destinations', type: 'destination' }));
    }

    if (!cat || cat === 'all' || cat === 'culinary' || cat === 'restaurants') {
      const params = searchParam ? [searchParam] : [];
      const where = searchParam ? 'WHERE name ILIKE $1' : '';
      const { rows } = await pool.query(`SELECT * FROM restaurants ${where} ORDER BY rating DESC`, params);
      restaurants = rows.map(r => ({ ...r, category: 'Culinary', type: 'restaurant' }));
    }

    const data = [...hotels, ...destinations, ...restaurants];
    res.json({ success: true, data, meta: { total: data.length } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

const getDestinations = async (req, res) => {
  try {
    const { subCategory, search } = req.query;
    const params = [];
    const conditions = [];
    if (subCategory) { params.push(subCategory); conditions.push(`sub_category = $${params.length}`); }
    if (search) { params.push(`%${search}%`); conditions.push(`name ILIKE $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(`SELECT * FROM destinations ${where} ORDER BY rating DESC`, params);
    res.json({ success: true, data: rows.map(d => ({ ...d, category: 'Destinations', type: 'destination' })) });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

const getDestinationById = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM destinations WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Destinasi tidak ditemukan' });
    res.json({ success: true, data: { ...rows[0], category: 'Destinations', type: 'destination' } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

const getRestaurants = async (req, res) => {
  try {
    const { search } = req.query;
    const params = search ? [`%${search}%`] : [];
    const where = search ? 'WHERE name ILIKE $1' : '';
    const { rows } = await pool.query(`SELECT * FROM restaurants ${where} ORDER BY rating DESC`, params);
    res.json({ success: true, data: rows.map(r => ({ ...r, category: 'Culinary', type: 'restaurant' })) });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

const getRestaurantById = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM restaurants WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Restoran tidak ditemukan' });
    res.json({ success: true, data: { ...rows[0], category: 'Culinary', type: 'restaurant' } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// GET /api/explore/categories — taksonomi tunggal backend (Fase 0).
// Tiap kategori membawa `count` + `available` dari ISI DB NYATA supaya
// Flutter bisa sembunyikan chip kosong (prinsip no-fake-data).
// Pemetaan chip Figma: Beach→beaches, Mountain→adventure (konten trekking),
// City→culture (konten kota/tradisi). Chip tanpa konten disembunyikan.
const getCategories = async (_req, res) => {
  try {
    const [{ rows: destCounts }, { rows: hotelRows }, { rows: restoRows }] = await Promise.all([
      pool.query(`SELECT sub_category, COUNT(*) AS n FROM destinations GROUP BY sub_category`),
      pool.query(`SELECT COUNT(*) AS n FROM hotels WHERE available = true`),
      pool.query(`SELECT COUNT(*) AS n FROM restaurants`),
    ]);
    const destN = Object.fromEntries(destCounts.map((r) => [r.sub_category, Number(r.n)]));
    const defs = [
      { id: 'beaches',   label: 'Beaches',   icon: 'beach_access',    description: 'Beautiful beaches in Lombok', count: destN.Beaches || 0 },
      { id: 'hotels',    label: 'Hotels',    icon: 'hotel',           description: 'Luxury resorts & villas', count: Number(hotelRows[0].n) },
      { id: 'culinary',  label: 'Culinary',  icon: 'restaurant',      description: 'Local delicacies', count: Number(restoRows[0].n) },
      { id: 'islands',   label: 'Islands',   icon: 'directions_boat', description: 'Gili Islands paradise', count: destN.Islands || 0 },
      { id: 'adventure', label: 'Adventure', icon: 'hiking',          description: 'Mount Rinjani trek', count: destN.Adventure || 0 },
      { id: 'culture',   label: 'Culture',   icon: 'museum',          description: 'Sasak tradition', count: destN.Culture || 0 },
    ];
    res.json({
      success: true,
      data: defs.map((d) => ({ ...d, available: d.count > 0 })),
    });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

module.exports = { getExplore, getDestinations, getDestinationById, getRestaurants, getRestaurantById, getCategories };
