// src/controllers/itinerariesController.js
// A5 (audit Figma): CRUD itinerary tersimpan — nav Itinerary, "View
// Itinerary" (My Trips), "Add to Itinerary" (trip planner). Semua scoped ke
// pemilik (user_id = JWT); admin tidak diberi jalan pintas baca itinerary
// user lain (data personal).

const pool = require('../config/db');

const STATUSES = ['draft', 'active', 'completed', 'cancelled'];
const KINDS = ['activity', 'meal', 'rest', 'transport', 'stay'];

async function ownItinerary(id, userId) {
  const { rows } = await pool.query(
    'SELECT * FROM itineraries WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return rows[0] || null;
}

async function itemsOf(itineraryId) {
  const { rows } = await pool.query(
    `SELECT * FROM itinerary_items WHERE itinerary_id = $1 ORDER BY day, position, created_at`,
    [itineraryId]
  );
  return rows;
}

// POST /api/itineraries — body { title, destination?, start_date?, end_date?, status?, items?[] }
// `items` opsional: simpan hasil trip-plan sekaligus (day,time,title,...).
const createItinerary = async (req, res) => {
  const client = await pool.connect();
  try {
    const { title, destination, start_date, end_date, status = 'draft', items = [] } = req.body;
    if (!title || !String(title).trim())
      return res.status(400).json({ success: false, message: 'title wajib diisi' });
    if (status && !STATUSES.includes(status))
      return res.status(400).json({ success: false, message: `status harus salah satu: ${STATUSES.join(', ')}` });
    if (!Array.isArray(items) || items.length > 200)
      return res.status(400).json({ success: false, message: 'items harus array (maks 200)' });

    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO itineraries (user_id, title, destination, start_date, end_date, status)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.id, String(title).trim(), destination || null, start_date || null, end_date || null, status]
    );
    const created = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it?.title) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: `items[${i}].title wajib diisi` });
      }
      if (it.kind && !KINDS.includes(it.kind)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: `items[${i}].kind harus salah satu: ${KINDS.join(', ')}` });
      }
      const { rows: ir } = await client.query(
        `INSERT INTO itinerary_items (itinerary_id, day, time, title, description, location, kind, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [rows[0].id, Number(it.day) >= 1 ? Number(it.day) : 1, it.time || null,
         String(it.title), it.description || null, it.location || null, it.kind || 'activity', i]
      );
      created.push(ir[0]);
    }
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: { ...rows[0], items: created } });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  } finally {
    client.release();
  }
};

// GET /api/itineraries/my
const getMyItineraries = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT it.*,
         (SELECT COUNT(*) FROM itinerary_items ii WHERE ii.itinerary_id = it.id) AS item_count,
         (SELECT COALESCE(MIN(ii.day), 0) FROM itinerary_items ii WHERE ii.itinerary_id = it.id) AS from_day,
         (SELECT COALESCE(MAX(ii.day), 0) FROM itinerary_items ii WHERE ii.itinerary_id = it.id) AS to_day
       FROM itineraries it WHERE user_id = $1 ORDER BY updated_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// GET /api/itineraries/:id — header + items
const getItineraryById = async (req, res) => {
  try {
    const it = await ownItinerary(req.params.id, req.user.id);
    if (!it) return res.status(404).json({ success: false, message: 'Itinerary tidak ditemukan' });
    res.json({ success: true, data: { ...it, items: await itemsOf(it.id) } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// PUT /api/itineraries/:id — partial update header
const updateItinerary = async (req, res) => {
  try {
    const it = await ownItinerary(req.params.id, req.user.id);
    if (!it) return res.status(404).json({ success: false, message: 'Itinerary tidak ditemukan' });
    const { title, destination, start_date, end_date, status } = req.body;
    if (status !== undefined && !STATUSES.includes(status))
      return res.status(400).json({ success: false, message: `status harus salah satu: ${STATUSES.join(', ')}` });
    if (title !== undefined && !String(title).trim())
      return res.status(400).json({ success: false, message: 'title tidak boleh kosong' });
    const { rows } = await pool.query(
      `UPDATE itineraries SET
         title = COALESCE($1, title), destination = COALESCE($2, destination),
         start_date = COALESCE($3, start_date), end_date = COALESCE($4, end_date),
         status = COALESCE($5, status), updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [title?.trim() ?? null, destination ?? null, start_date ?? null, end_date ?? null, status ?? null, it.id]
    );
    res.json({ success: true, data: { ...rows[0], items: await itemsOf(it.id) } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// DELETE /api/itineraries/:id (items ikut terhapus via CASCADE)
const deleteItinerary = async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM itineraries WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (rowCount === 0) return res.status(404).json({ success: false, message: 'Itinerary tidak ditemukan' });
    res.json({ success: true, message: 'Itinerary dihapus' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// POST /api/itineraries/:id/items — "Add to Itinerary" dari trip planner
const addItem = async (req, res) => {
  try {
    const it = await ownItinerary(req.params.id, req.user.id);
    if (!it) return res.status(404).json({ success: false, message: 'Itinerary tidak ditemukan' });
    const { day = 1, time, title, description, location, kind = 'activity' } = req.body;
    if (!title || !String(title).trim())
      return res.status(400).json({ success: false, message: 'title wajib diisi' });
    if (!KINDS.includes(kind))
      return res.status(400).json({ success: false, message: `kind harus salah satu: ${KINDS.join(', ')}` });
    const { rows: pos } = await pool.query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM itinerary_items WHERE itinerary_id = $1 AND day = $2',
      [it.id, Number(day) >= 1 ? Number(day) : 1]
    );
    const { rows } = await pool.query(
      `INSERT INTO itinerary_items (itinerary_id, day, time, title, description, location, kind, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [it.id, Number(day) >= 1 ? Number(day) : 1, time || null, String(title).trim(),
       description || null, location || null, kind, Number(pos[0].next)]
    );
    await pool.query('UPDATE itineraries SET updated_at = NOW() WHERE id = $1', [it.id]);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// PATCH /api/itineraries/items/:itemId — partial update item milik sendiri
const updateItem = async (req, res) => {
  try {
    const { rows: found } = await pool.query(
      `SELECT ii.* FROM itinerary_items ii JOIN itineraries it ON it.id = ii.itinerary_id
       WHERE ii.id = $1 AND it.user_id = $2`,
      [req.params.itemId, req.user.id]
    );
    if (found.length === 0) return res.status(404).json({ success: false, message: 'Item tidak ditemukan' });
    const { day, time, title, description, location, kind, position } = req.body;
    if (kind !== undefined && !KINDS.includes(kind))
      return res.status(400).json({ success: false, message: `kind harus salah satu: ${KINDS.join(', ')}` });
    if (title !== undefined && !String(title).trim())
      return res.status(400).json({ success: false, message: 'title tidak boleh kosong' });
    const { rows } = await pool.query(
      `UPDATE itinerary_items SET
         day = COALESCE($1, day), time = COALESCE($2, time), title = COALESCE($3, title),
         description = COALESCE($4, description), location = COALESCE($5, location),
         kind = COALESCE($6, kind), position = COALESCE($7, position)
       WHERE id = $8 RETURNING *`,
      [day ?? null, time ?? null, title?.trim() ?? null, description ?? null,
       location ?? null, kind ?? null, position ?? null, found[0].id]
    );
    res.json({ success: true, data: rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// DELETE /api/itineraries/items/:itemId
const deleteItem = async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM itinerary_items ii USING itineraries it
       WHERE ii.id = $1 AND ii.itinerary_id = it.id AND it.user_id = $2`,
      [req.params.itemId, req.user.id]
    );
    if (rowCount === 0) return res.status(404).json({ success: false, message: 'Item tidak ditemukan' });
    res.json({ success: true, message: 'Item dihapus' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

module.exports = {
  createItinerary, getMyItineraries, getItineraryById, updateItinerary,
  deleteItinerary, addItem, updateItem, deleteItem,
};
