const pool = require('../config/db');
const { sendToToken } = require('../services/notificationService');

// POST /api/notifications/register-token
// Dipanggil app setelah login & setiap kali FCM token refresh.
const registerToken = async (req, res) => {
  try {
    const { token, platform } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'token wajib diisi' });

    await pool.query(
      `UPDATE users SET fcm_token = $1, fcm_platform = $2, updated_at = NOW() WHERE id = $3`,
      [token, platform || null, req.user.id]
    );

    res.json({ success: true, message: 'FCM token terdaftar' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// DELETE /api/notifications/token
// Dipanggil saat logout supaya device tidak lagi menerima push untuk akun ini.
const unregisterToken = async (req, res) => {
  try {
    await pool.query(
      `UPDATE users SET fcm_token = NULL, fcm_platform = NULL, updated_at = NOW() WHERE id = $1`,
      [req.user.id]
    );
    res.json({ success: true, message: 'FCM token dihapus' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// POST /api/notifications/test
// Endpoint khusus TESTING: kirim push notification ke token yang dikirim di
// body, atau kalau tidak dikirim, pakai fcm_token milik user yang sedang login.
// Dipakai oleh halaman /push-test.html maupun langsung dari Postman/curl.
const sendTestNotification = async (req, res) => {
  try {
    const { token, title, body, data } = req.body;

    let targetToken = token;
    if (!targetToken) {
      const { rows } = await pool.query('SELECT fcm_token FROM users WHERE id = $1', [req.user.id]);
      targetToken = rows[0]?.fcm_token;
    }
    if (!targetToken) {
      return res.status(400).json({
        success: false,
        message: 'Tidak ada FCM token. Kirim "token" di body, atau register-token dulu dari app.',
      });
    }

    const messageId = await sendToToken(
      targetToken,
      { title: title || 'Test Notifikasi Sasacation', body: body || 'Ini pesan test push notification 🌴' },
      data && typeof data === 'object' ? stringifyValues(data) : {}
    );

    res.json({ success: true, message: 'Push notification terkirim', data: { messageId } });
  } catch (e) {
    if (e.code === 'FIREBASE_NOT_READY') {
      return res.status(503).json({ success: false, message: e.message });
    }
    res.status(500).json({ success: false, message: 'Gagal mengirim push notification', error: e.message });
  }
};

function stringifyValues(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = String(v);
  return out;
}

module.exports = { registerToken, unregisterToken, sendTestNotification };
