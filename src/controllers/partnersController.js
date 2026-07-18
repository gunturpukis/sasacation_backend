const pool = require('../config/db');

// ─── POST /api/partners/apply ──────────────────────────────────────────────
// Auth: user biasa (siapapun yang login) bisa apply jadi mitra.
// TIDAK langsung mengubah role user jadi 'partner' — status 'pending' dulu,
// role baru berubah setelah admin approve (lihat approvePartner).
const applyForPartner = async (req, res) => {
  try {
    const { businessName, description, phone, address } = req.body;
    if (!businessName || !phone || !address)
      return res.status(400).json({ success: false, message: 'businessName, phone, address wajib diisi' });

    // Cegah user yang sudah punya pengajuan (apapun statusnya) apply lagi —
    // kalau ditolak, admin yang perlu ubah status ke 'pending' lagi lewat
    // endpoint terpisah (atau kita buat reapply nanti kalau dibutuhkan).
    const { rows: existing } = await pool.query('SELECT id, status FROM properties WHERE owner_id = $1', [req.user.id]);
    if (existing.length > 0)
      return res.status(409).json({
        success: false,
        message: `Anda sudah punya pengajuan mitra dengan status '${existing[0].status}'`,
      });

    const { rows } = await pool.query(
      `INSERT INTO properties (owner_id, business_name, description, phone, address, status)
       VALUES ($1,$2,$3,$4,$5,'pending') RETURNING *`,
      [req.user.id, businessName, description || null, phone, address]
    );

    res.status(201).json({
      success: true,
      message: 'Pengajuan mitra berhasil dikirim, menunggu verifikasi admin',
      data: rows[0],
    });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// ─── GET /api/partners/me ───────────────────────────────────────────────────
// Auth: user biasa — supaya bisa cek status pengajuannya (pending/verified/rejected)
const getMyProperty = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM properties WHERE owner_id = $1', [req.user.id]);
    if (rows.length === 0)
      return res.status(404).json({ success: false, message: 'Anda belum mengajukan sebagai mitra' });
    res.json({ success: true, data: rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// ─── PUT /api/partners/me ───────────────────────────────────────────────────
// Auth: partner (sudah verified) — update info bisnis sendiri.
const updateMyProperty = async (req, res) => {
  try {
    const { businessName, description, phone, address } = req.body;
    const { rows } = await pool.query(
      `UPDATE properties
       SET business_name = COALESCE($1, business_name),
           description   = COALESCE($2, description),
           phone         = COALESCE($3, phone),
           address       = COALESCE($4, address),
           updated_at    = NOW()
       WHERE owner_id = $5
       RETURNING *`,
      [businessName, description, phone, address, req.user.id]
    );
    if (rows.length === 0)
      return res.status(404).json({ success: false, message: 'Properti tidak ditemukan' });
    res.json({ success: true, message: 'Info bisnis berhasil diperbarui', data: rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// ─── GET /api/admin/partners?status=pending ────────────────────────────────
// Auth: admin. Default nampilin semua kalau query 'status' tidak diisi.
const listPartnerApplications = async (req, res) => {
  try {
    const { status } = req.query;
    const validStatuses = ['pending', 'verified', 'rejected', 'suspended'];
    const params = [];
    let query = `
      SELECT p.*, u.name AS owner_name, u.email AS owner_email
      FROM properties p
      JOIN users u ON u.id = p.owner_id
    `;
    if (status && validStatuses.includes(status)) {
      query += ' WHERE p.status = $1';
      params.push(status);
    }
    query += ' ORDER BY p.created_at DESC';

    const { rows } = await pool.query(query, params);
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// ─── PATCH /api/admin/partners/:id/approve ─────────────────────────────────
// Auth: admin. Verifikasi properti + upgrade role user jadi 'partner' dalam
// satu transaksi atomic — kalau salah satu gagal, dua-duanya di-rollback
// supaya tidak ada properti 'verified' tanpa user yang benar-benar 'partner'
// (atau sebaliknya).
const approvePartner = async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows: propRows } = await client.query('SELECT * FROM properties WHERE id = $1', [req.params.id]);
    if (propRows.length === 0)
      return res.status(404).json({ success: false, message: 'Pengajuan tidak ditemukan' });

    const property = propRows[0];
    if (property.status === 'verified')
      return res.status(400).json({ success: false, message: 'Properti ini sudah terverifikasi' });

    await client.query('BEGIN');
    const updatedProperty = await client.query(
      `UPDATE properties SET status = 'verified', rejection_reason = NULL, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    await client.query(`UPDATE users SET role = 'partner', updated_at = NOW() WHERE id = $1`, [property.owner_id]);
    await client.query('COMMIT');

    res.json({ success: true, message: 'Mitra berhasil diverifikasi', data: updatedProperty.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  } finally {
    client.release();
  }
};

// ─── PATCH /api/admin/partners/:id/reject ──────────────────────────────────
// Auth: admin. Body opsional: { reason: string }
const rejectPartner = async (req, res) => {
  try {
    const { reason } = req.body;
    const { rows } = await pool.query(
      `UPDATE properties SET status = 'rejected', rejection_reason = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [reason || null, req.params.id]
    );
    if (rows.length === 0)
      return res.status(404).json({ success: false, message: 'Pengajuan tidak ditemukan' });
    res.json({ success: true, message: 'Pengajuan mitra ditolak', data: rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

module.exports = {
  applyForPartner,
  getMyProperty,
  updateMyProperty,
  listPartnerApplications,
  approvePartner,
  rejectPartner,
};
