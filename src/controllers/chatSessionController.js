// src/controllers/chatSessionController.js
const { getLatestSessionWithMessages } = require('../services/chatSessionService');

// GET /api/chat/sessions/latest
// Dipanggil app saat startup (kalau user login) untuk restore percakapan
// terakhir ke AiBloc, supaya chat tidak "amnesia" tiap buka app.
const getLatestSession = async (req, res) => {
  try {
    const session = await getLatestSessionWithMessages(req.user.id);
    // null itu valid (user belum pernah chat) — bukan error
    res.json({ success: true, data: session });
  } catch (e) {
    console.error('Get latest session error:', e);
    res.status(500).json({ success: false, message: 'Gagal mengambil riwayat chat' });
  }
};

module.exports = { getLatestSession };
