const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

function makeToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });
}
function safeUser(u) {
  const { password, ...rest } = u;
  return rest;
}

const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ success: false, message: 'Nama, email, dan password wajib diisi' });
    if (password.length < 6)
      return res.status(400).json({ success: false, message: 'Password minimal 6 karakter' });

    const { rows: existing } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.length > 0)
      return res.status(409).json({ success: false, message: 'Email sudah terdaftar' });

    const hashed = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password, role, provider) VALUES ($1,$2,$3,'user','email') RETURNING *`,
      [name, email, hashed]
    );
    const user = rows[0];
    const token = makeToken(user);
    res.status(201).json({ success: true, message: 'Registrasi berhasil', data: { user: safeUser(user), token } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Email dan password wajib diisi' });

    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (rows.length === 0 || !rows[0].password)
      return res.status(401).json({ success: false, message: 'Email atau password salah' });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ success: false, message: 'Email atau password salah' });

    const token = makeToken(user);
    res.json({ success: true, message: 'Login berhasil', data: { user: safeUser(user), token } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

const socialLogin = async (req, res) => {
  try {
    const { provider, providerId, email, name, avatar } = req.body;
    if (!provider || !providerId || !email)
      return res.status(400).json({ success: false, message: 'provider, providerId, email wajib diisi' });

    let { rows } = await pool.query(
      'SELECT * FROM users WHERE (provider_id = $1 AND provider = $2) OR email = $3',
      [providerId, provider, email]
    );

    let user;
    if (rows.length === 0) {
      const inserted = await pool.query(
        `INSERT INTO users (name, email, provider, provider_id, avatar, role)
         VALUES ($1,$2,$3,$4,$5,'user') RETURNING *`,
        [name || email.split('@')[0], email, provider, providerId, avatar || null]
      );
      user = inserted.rows[0];
    } else {
      const updated = await pool.query(
        `UPDATE users SET provider=$1, provider_id=$2, avatar=COALESCE($3, avatar), updated_at=NOW()
         WHERE id=$4 RETURNING *`,
        [provider, providerId, avatar, rows[0].id]
      );
      user = updated.rows[0];
    }

    const token = makeToken(user);
    res.json({ success: true, message: `Login dengan ${provider} berhasil`, data: { user: safeUser(user), token } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

const getMe = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
    res.json({ success: true, data: { user: safeUser(rows[0]) } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

const updateProfile = async (req, res) => {
  try {
    const { name, avatar } = req.body;
    const { rows } = await pool.query(
      `UPDATE users SET name=COALESCE($1,name), avatar=COALESCE($2,avatar), updated_at=NOW() WHERE id=$3 RETURNING *`,
      [name, avatar, req.user.id]
    );
    res.json({ success: true, message: 'Profil berhasil diupdate', data: { user: safeUser(rows[0]) } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

module.exports = { register, login, socialLogin, getMe, updateProfile };
