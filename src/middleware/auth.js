const jwt = require('jsonwebtoken');
const pool = require('../config/db');

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer '))
      return res.status(401).json({ success: false, message: 'Token tidak ditemukan' });

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const { rows } = await pool.query('SELECT id, email, role, name FROM users WHERE id = $1', [decoded.id]);
    if (rows.length === 0)
      return res.status(401).json({ success: false, message: 'User tidak ditemukan' });

    req.user = rows[0];
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Token tidak valid atau kadaluarsa' });
  }
};

const adminMiddleware = (req, res, next) => {
  if (req.user?.role !== 'admin')
    return res.status(403).json({ success: false, message: 'Akses ditolak. Hanya admin.' });
  next();
};

// Dipakai untuk endpoint khusus mitra (kelola properti, hotel sendiri, dst).
// Admin juga diloloskan supaya bisa melakukan oversight/troubleshooting atas
// nama mitra tanpa perlu akun terpisah.
const partnerMiddleware = (req, res, next) => {
  if (req.user?.role !== 'partner' && req.user?.role !== 'admin')
    return res.status(403).json({ success: false, message: 'Akses ditolak. Hanya untuk mitra terverifikasi.' });
  next();
};

module.exports = { authMiddleware, adminMiddleware, partnerMiddleware };
