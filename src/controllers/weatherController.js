// src/controllers/weatherController.js
// GET /api/weather?lat=&lng= — publik (kartu cuaca tampil untuk guest juga).
// Balas 503 bila WEATHER_API_KEY belum diisi, 502 bila upstream error
// (mis. key invalid/belum aktif — key baru OpenWeather bisa butuh
// beberapa jam aktivasi).

const { getWeatherWithAlert } = require('../services/weatherService');

const getWeather = async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng ?? req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return res.status(400).json({ success: false, message: 'lat (-90..90) dan lng (-180..180) wajib angka valid' });
    }

    const data = await getWeatherWithAlert(lat, lng);
    res.json({ success: true, data });
  } catch (e) {
    if (e.code === 'WEATHER_NOT_READY') {
      return res.status(503).json({ success: false, message: e.message });
    }
    console.error('[weather] error:', e.message);
    res.status(502).json({ success: false, message: 'Gagal mengambil data cuaca', error: e.message });
  }
};

module.exports = { getWeather };
