// src/controllers/pollsController.js
// A1 (audit Figma): vote grup — "New Vote: Sunset Dinner. Choose between
// 'The Rock Bar' or 'La Lucciola'. Vote now".
//
// Aturan: 1 user = 1 suara per poll (pindah pilihan = upsert). Poll terbuka =
// status 'open' DAN (tanpa closes_at ATAU belum lewat). Hanya pembuat yang
// bisa tutup/hapus.

const pool = require('../config/db');

function isOpen(poll) {
  return poll.status === 'open' && (!poll.closes_at || new Date(poll.closes_at) > new Date());
}

async function pollDetail(pollId, viewerId) {
  const { rows } = await pool.query('SELECT * FROM polls WHERE id = $1', [pollId]);
  if (rows.length === 0) return null;
  const poll = rows[0];
  const [{ rows: options }, { rows: myVote }] = await Promise.all([
    pool.query(
      `SELECT o.id, o.label, o.position,
              (SELECT COUNT(*) FROM poll_votes v WHERE v.option_id = o.id) AS votes
       FROM poll_options o WHERE o.poll_id = $1 ORDER BY o.position`,
      [pollId]
    ),
    viewerId
      ? pool.query('SELECT option_id FROM poll_votes WHERE poll_id = $1 AND user_id = $2', [pollId, viewerId])
      : { rows: [] },
  ]);
  const total = options.reduce((s, o) => s + Number(o.votes), 0);
  return {
    ...poll,
    is_open: isOpen(poll),
    total_votes: total,
    my_option_id: myVote[0]?.option_id || null,
    options: options.map((o) => ({
      id: o.id, label: o.label, position: o.position,
      votes: Number(o.votes),
      pct: total > 0 ? Math.round((Number(o.votes) / total) * 100) : 0,
    })),
  };
}

// POST /api/polls — body { title, options: [label, ...] (2-10), description?, closes_at? }
const createPoll = async (req, res) => {
  const client = await pool.connect();
  try {
    const { title, options, description, closes_at } = req.body;
    if (!title || !String(title).trim())
      return res.status(400).json({ success: false, message: 'title wajib diisi' });
    if (!Array.isArray(options) || options.length < 2 || options.length > 10)
      return res.status(400).json({ success: false, message: 'options wajib array 2-10 pilihan' });
    const labels = options.map((o) => String(o || '').trim()).filter(Boolean);
    if (labels.length < 2)
      return res.status(400).json({ success: false, message: 'minimal 2 pilihan tidak kosong' });

    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO polls (user_id, title, description, closes_at) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.user.id, String(title).trim(), description || null, closes_at || null]
    );
    for (let i = 0; i < labels.length; i++) {
      await client.query(
        `INSERT INTO poll_options (poll_id, label, position) VALUES ($1,$2,$3)`,
        [rows[0].id, labels[i].slice(0, 100), i]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: await pollDetail(rows[0].id, req.user.id) });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  } finally {
    client.release();
  }
};

// GET /api/polls/open — vote yang bisa diikuti (terbaru dulu)
const getOpenPolls = async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const { rows } = await pool.query(
      `SELECT * FROM polls WHERE status = 'open' AND (closes_at IS NULL OR closes_at > NOW())
       ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    const data = [];
    for (const p of rows) data.push(await pollDetail(p.id, req.user.id));
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// GET /api/polls/my — vote yang saya buat
const getMyPolls = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM polls WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
    const data = [];
    for (const p of rows) data.push(await pollDetail(p.id, req.user.id));
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// GET /api/polls/:id
const getPollById = async (req, res) => {
  try {
    const detail = await pollDetail(req.params.id, req.user.id);
    if (!detail) return res.status(404).json({ success: false, message: 'Vote tidak ditemukan' });
    res.json({ success: true, data: detail });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// POST /api/polls/:id/vote — body { optionId }. Pindah pilihan = ganti suara.
const vote = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM polls WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Vote tidak ditemukan' });
    if (!isOpen(rows[0]))
      return res.status(400).json({ success: false, message: 'Vote sudah ditutup' });

    const { rows: opt } = await pool.query(
      'SELECT id FROM poll_options WHERE id = $1 AND poll_id = $2',
      [req.body.optionId, req.params.id]
    );
    if (opt.length === 0)
      return res.status(400).json({ success: false, message: 'optionId tidak valid untuk vote ini' });

    await pool.query(
      `INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES ($1,$2,$3)
       ON CONFLICT (poll_id, user_id) DO UPDATE SET option_id = EXCLUDED.option_id, created_at = NOW()`,
      [req.params.id, req.body.optionId, req.user.id]
    );
    res.json({ success: true, data: await pollDetail(req.params.id, req.user.id) });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// PATCH /api/polls/:id/close — hanya pembuat
const closePoll = async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE polls SET status = 'closed' WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (rowCount === 0)
      return res.status(404).json({ success: false, message: 'Vote tidak ditemukan atau bukan milik Anda' });
    res.json({ success: true, data: await pollDetail(req.params.id, req.user.id) });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// DELETE /api/polls/:id — hanya pembuat (options/votes CASCADE)
const deletePoll = async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM polls WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (rowCount === 0)
      return res.status(404).json({ success: false, message: 'Vote tidak ditemukan atau bukan milik Anda' });
    res.json({ success: true, message: 'Vote dihapus' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

module.exports = { createPoll, getOpenPolls, getMyPolls, getPollById, vote, closePoll, deletePoll };
