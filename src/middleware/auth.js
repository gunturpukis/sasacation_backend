const jwt = require('jsonwebtoken');
const db = require('../config/database');

const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token tidak ditemukan' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = db.users.find(u => u.id === decoded.id);
    if (!user) {
      return res.status(401).json({ success: false, message: 'User tidak ditemukan' });
    }

    req.user = { id: user.id, email: user.email, role: user.role, name: user.name };
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Token tidak valid atau kadaluarsa' });
  }
};

const adminMiddleware = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Akses ditolak. Hanya admin.' });
  }
  next();
};

module.exports = { authMiddleware, adminMiddleware };
