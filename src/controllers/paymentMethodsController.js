// src/controllers/paymentMethodsController.js
// P4 (FLUTTER_P3_CONTRACTS.md): Saved Payment Methods.
//
// Kartu dibuat OTOMATIS oleh captureSavedCard() saat webhook Midtrans sukses
// (user centang "save card" di Snap) — tidak ada POST manual, karena token
// hanya bisa lahir dari otorisasi 3DS yang asli. Endpoint di sini untuk
// baca/atur/hapus saja.

const pool = require('../config/db');
const { toMethodJson } = require('../services/paymentMethodService');

// GET /api/payment-methods
const listMethods = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, brand, last4, exp_month, exp_year, is_primary, label, created_at
       FROM payment_methods WHERE user_id = $1
       ORDER BY is_primary DESC, created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, data: rows.map(toMethodJson) });
  } catch (e) {
    console.error('[payment-methods list] error:', e.message);
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// PATCH /api/payment-methods/:id/primary — jadikan utama (atomik, milik sendiri).
const setPrimary = async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE payment_methods SET is_primary = (id = $2) WHERE user_id = $1`,
      [req.user.id, req.params.id]
    );
    // rowCount = jumlah baris MILIK user (bukan cuma 1) — perlu pastikan id-nya ada.
    const { rows } = await pool.query(
      `SELECT id FROM payment_methods WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (rows.length === 0 || rowCount === 0)
      return res.status(404).json({ success: false, message: 'Metode pembayaran tidak ditemukan' });
    res.json({ success: true, message: 'Metode utama diperbarui' });
  } catch (e) {
    console.error('[payment-methods primary] error:', e.message);
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// DELETE /api/payment-methods/:id — lepas kartu dari akun. Token di vault
// Midtrans dibiarkan expire sendiri (tidak ada API hapus token); backend tidak
// akan memakainya lagi karena baris referensinya sudah hilang.
const removeMethod = async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM payment_methods WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (rowCount === 0)
      return res.status(404).json({ success: false, message: 'Metode pembayaran tidak ditemukan' });
    res.json({ success: true, message: 'Metode pembayaran dihapus' });
  } catch (e) {
    console.error('[payment-methods delete] error:', e.message);
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// PATCH /api/payment-methods/:id — ganti julukan kartu ("Business").
// Body: { label }. String kosong/null = hapus julukan.
const renameMethod = async (req, res) => {
  try {
    const { label } = req.body;
    if (label !== undefined && label !== null && typeof label !== 'string')
      return res.status(400).json({ success: false, message: 'label harus string' });
    const clean = typeof label === 'string' && label.trim() ? label.trim().slice(0, 30) : null;
    const { rowCount } = await pool.query(
      `UPDATE payment_methods SET label = $1 WHERE id = $2 AND user_id = $3`,
      [clean, req.params.id, req.user.id]
    );
    if (rowCount === 0)
      return res.status(404).json({ success: false, message: 'Metode pembayaran tidak ditemukan' });
    res.json({ success: true, message: 'Julukan kartu diperbarui' });
  } catch (e) {
    console.error('[payment-methods rename] error:', e.message);
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

module.exports = { listMethods, setPrimary, removeMethod, renameMethod };
