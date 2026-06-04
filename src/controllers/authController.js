const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');

// // POST /api/auth/register
const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Nama, email, dan password wajib diisi' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password minimal 6 karakter' });
    }

    const existingUser = db.users.find(u => u.email === email);
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'Email sudah terdaftar' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      id: uuidv4(),
      name,
      email,
      password: hashedPassword,
      role: 'user',
      avatar: null,
      provider: 'email',
      createdAt: new Date(),
    };

    db.users.push(newUser);

    const token = jwt.sign(
      { id: newUser.id, email: newUser.email, role: newUser.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    const { password: _, ...userWithoutPassword } = newUser;
    res.status(201).json({
      success: true,
      message: 'Registrasi berhasil',
      data: { user: userWithoutPassword, token },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// POST /api/auth/login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email dan password wajib diisi' });
    }

    const user = db.users.find(u => u.email === email);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Email atau password salah' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Email atau password salah' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    const { password: _, ...userWithoutPassword } = user;
    res.json({
      success: true,
      message: 'Login berhasil',
      data: { user: userWithoutPassword, token },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// POST /api/auth/social
// Provider: 'google' | 'apple'
// Body: { provider, providerId, email, name, avatar? }
const socialLogin = async (req, res) => {
  try {
    const { provider, providerId, email, name, avatar } = req.body;

    if (!provider || !providerId || !email) {
      return res.status(400).json({ success: false, message: 'provider, providerId, email wajib diisi' });
    }

    // Cari user berdasarkan providerId atau email
    let user = db.users.find(
      u => (u.providerId === providerId && u.provider === provider) || u.email === email
    );

    if (!user) {
      // Buat user baru dari social login
      user = {
        id: uuidv4(),
        name: name || email.split('@')[0],
        email,
        password: null, // social login tidak punya password
        role: 'user',
        avatar: avatar || null,
        provider,
        providerId,
        createdAt: new Date(),
      };
      db.users.push(user);
    } else {
      // Update info terbaru dari provider
      const idx = db.users.findIndex(u => u.id === user.id);
      db.users[idx].provider = provider;
      db.users[idx].providerId = providerId;
      if (avatar) db.users[idx].avatar = avatar;
      user = db.users[idx];
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    const { password: _, ...userWithoutPassword } = user;
    res.json({
      success: true,
      message: `Login dengan ${provider} berhasil`,
      data: { user: userWithoutPassword, token },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// GET /api/auth/me
const getMe = (req, res) => {
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
  const { password: _, ...userWithoutPassword } = user;
  res.json({ success: true, data: { user: userWithoutPassword } });
};

// PUT /api/auth/profile
const updateProfile = async (req, res) => {
  try {
    const { name, avatar } = req.body;
    const userIndex = db.users.findIndex(u => u.id === req.user.id);
    if (userIndex === -1) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });

    if (name) db.users[userIndex].name = name;
    if (avatar !== undefined) db.users[userIndex].avatar = avatar;

    const { password: _, ...userWithoutPassword } = db.users[userIndex];
    res.json({ success: true, message: 'Profil berhasil diupdate', data: { user: userWithoutPassword } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

module.exports = { register, login, socialLogin, getMe, updateProfile };

// // POST /api/auth/register
// const register = async (req, res) => {
//   try {
//     const { name, email, password } = req.body;

//     if (!name || !email || !password) {
//       return res.status(400).json({ success: false, message: 'Nama, email, dan password wajib diisi' });
//     }

//     if (password.length < 6) {
//       return res.status(400).json({ success: false, message: 'Password minimal 6 karakter' });
//     }

//     const existingUser = db.users.find(u => u.email === email);
//     if (existingUser) {
//       return res.status(409).json({ success: false, message: 'Email sudah terdaftar' });
//     }

//     const hashedPassword = await bcrypt.hash(password, 10);
//     const newUser = {
//       id: uuidv4(),
//       name,
//       email,
//       password: hashedPassword,
//       role: 'user',
//       avatar: null,
//       createdAt: new Date(),
//     };

//     db.users.push(newUser);

//     const token = jwt.sign(
//       { id: newUser.id, email: newUser.email, role: newUser.role },
//       process.env.JWT_SECRET,
//       { expiresIn: process.env.JWT_EXPIRES_IN }
//     );

//     const { password: _, ...userWithoutPassword } = newUser;
//     res.status(201).json({
//       success: true,
//       message: 'Registrasi berhasil',
//       data: { user: userWithoutPassword, token },
//     });
//   } catch (error) {
//     res.status(500).json({ success: false, message: 'Server error', error: error.message });
//   }
// };

// // POST /api/auth/login
// const login = async (req, res) => {
//   try {
//     const { email, password } = req.body;

//     if (!email || !password) {
//       return res.status(400).json({ success: false, message: 'Email dan password wajib diisi' });
//     }

//     const user = db.users.find(u => u.email === email);
//     if (!user) {
//       return res.status(401).json({ success: false, message: 'Email atau password salah' });
//     }

//     const isMatch = await bcrypt.compare(password, user.password);
//     if (!isMatch) {
//       return res.status(401).json({ success: false, message: 'Email atau password salah' });
//     }

//     const token = jwt.sign(
//       { id: user.id, email: user.email, role: user.role },
//       process.env.JWT_SECRET,
//       { expiresIn: process.env.JWT_EXPIRES_IN }
//     );

//     const { password: _, ...userWithoutPassword } = user;
//     res.json({
//       success: true,
//       message: 'Login berhasil',
//       data: { user: userWithoutPassword, token },
//     });
//   } catch (error) {
//     res.status(500).json({ success: false, message: 'Server error', error: error.message });
//   }
// };

// GET /api/auth/me
// const getMe = (req, res) => {
//   const user = db.users.find(u => u.id === req.user.id);
//   if (!user) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
//   const { password: _, ...userWithoutPassword } = user;
//   res.json({ success: true, data: { user: userWithoutPassword } });
// };

// // PUT /api/auth/profile
// const updateProfile = async (req, res) => {
//   try {
//     const { name, avatar } = req.body;
//     const userIndex = db.users.findIndex(u => u.id === req.user.id);
//     if (userIndex === -1) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });

//     if (name) db.users[userIndex].name = name;
//     if (avatar !== undefined) db.users[userIndex].avatar = avatar;

//     const { password: _, ...userWithoutPassword } = db.users[userIndex];
//     res.json({ success: true, message: 'Profil berhasil diupdate', data: { user: userWithoutPassword } });
//   } catch (error) {
//     res.status(500).json({ success: false, message: 'Server error', error: error.message });
//   }
// };

// module.exports = { register, login, getMe, updateProfile };
