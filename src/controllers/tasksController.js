// src/controllers/tasksController.js
// A3 (audit Figma): kartu Travel Task — semua scoped ke pemilik.

const pool = require('../config/db');

const KINDS = ['flight_checkin', 'reminder', 'payment', 'document', 'other'];

// POST /api/tasks
const createTask = async (req, res) => {
  try {
    const { title, kind = 'reminder', booking_id, detail, due_at, payload } = req.body;
    if (!title || !String(title).trim())
      return res.status(400).json({ success: false, message: 'title wajib diisi' });
    if (!KINDS.includes(kind))
      return res.status(400).json({ success: false, message: `kind harus salah satu: ${KINDS.join(', ')}` });
    if (payload !== undefined && (typeof payload !== 'object' || payload === null || Array.isArray(payload)))
      return res.status(400).json({ success: false, message: 'payload harus objek JSON' });
    if (booking_id) {
      const { rows } = await pool.query('SELECT id FROM bookings WHERE id = $1 AND user_id = $2', [booking_id, req.user.id]);
      if (rows.length === 0)
        return res.status(400).json({ success: false, message: 'booking_id bukan milik Anda' });
    }

    const { rows } = await pool.query(
      `INSERT INTO travel_tasks (user_id, booking_id, kind, title, detail, due_at, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.id, booking_id || null, kind, String(title).trim().slice(0, 120),
       detail || null, due_at || null, JSON.stringify(payload || {})]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// GET /api/tasks/my?done=&upcoming=true — upcoming = belum selesai + ada due,
// terurut due terdekat (NULLS LAST).
const getMyTasks = async (req, res) => {
  try {
    const conditions = ['user_id = $1'];
    const params = [req.user.id];
    if (req.query.done === 'true') conditions.push('done = true');
    else if (req.query.done === 'false') conditions.push('done = false');
    if (req.query.upcoming === 'true') conditions.push('done = false');

    const { rows } = await pool.query(
      `SELECT * FROM travel_tasks WHERE ${conditions.join(' AND ')}
       ORDER BY due_at NULLS LAST, created_at DESC`,
      params
    );
    const overdue = rows.filter((t) => !t.done && t.due_at && new Date(t.due_at) < new Date()).length;
    res.json({ success: true, data: rows, meta: { total: rows.length, overdue } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// PUT /api/tasks/:id — partial update milik sendiri
const updateTask = async (req, res) => {
  try {
    const { title, kind, detail, due_at, payload } = req.body;
    if (kind !== undefined && !KINDS.includes(kind))
      return res.status(400).json({ success: false, message: `kind harus salah satu: ${KINDS.join(', ')}` });
    if (title !== undefined && !String(title).trim())
      return res.status(400).json({ success: false, message: 'title tidak boleh kosong' });
    if (payload !== undefined && (typeof payload !== 'object' || payload === null || Array.isArray(payload)))
      return res.status(400).json({ success: false, message: 'payload harus objek JSON' });

    const { rows } = await pool.query(
      `UPDATE travel_tasks SET
         title = COALESCE($1, title), kind = COALESCE($2, kind),
         detail = COALESCE($3, detail), due_at = COALESCE($4, due_at),
         payload = COALESCE($5, payload)
       WHERE id = $6 AND user_id = $7 RETURNING *`,
      [title?.trim() ?? null, kind ?? null, detail ?? null, due_at ?? null,
       payload ? JSON.stringify(payload) : null, req.params.id, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Task tidak ditemukan' });
    res.json({ success: true, data: rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// PATCH /api/tasks/:id/done — body { done: bool }
const setDone = async (req, res) => {
  try {
    if (typeof req.body.done !== 'boolean')
      return res.status(400).json({ success: false, message: 'done harus boolean' });
    const { rows } = await pool.query(
      `UPDATE travel_tasks SET done = $1 WHERE id = $2 AND user_id = $3 RETURNING *`,
      [req.body.done, req.params.id, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Task tidak ditemukan' });
    res.json({ success: true, data: rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// DELETE /api/tasks/:id
const deleteTask = async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM travel_tasks WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (rowCount === 0) return res.status(404).json({ success: false, message: 'Task tidak ditemukan' });
    res.json({ success: true, message: 'Task dihapus' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

module.exports = { createTask, getMyTasks, updateTask, setDone, deleteTask };
