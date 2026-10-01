// src/controllers/impactController.js
// P3 (FLUTTER_P3_CONTRACTS.md): Local Impact Score untuk SustainibilityScreen.
//
// Prinsip Flutter: tidak ada data palsu — semua angka di sini DERIVASI dari
// data nyata (payments sukses + flag hotels.is_local_business), bukan hardcoded.
// User baru / guest dapat zero-state yang jujur (skor 0, array kosong), bukan
// angka ilustrasi.
//
// Aturan skor (terdokumentasi supaya Flutter & audit bisa mengandalkan):
//   - 1 USD belanja di usaha lokal = 10 poin, max 1000.
//   - Level: 0–99 Seedling, 100–299 Explorer, 300–599 Supporter,
//     600–849 Champion, 850+ Guardian of Bali.
//   - Sertifikat = derivasi per usaha lokal yang pernah dikunjungi
//     (1 sertifikat per hotel lokal dengan payment sukses).

const pool = require('../config/db');

const MAX_SCORE = 1000;
const SCORE_PER_USD = 10;
const USD_TO_IDR_RATE = Number(process.env.MIDTRANS_USD_TO_IDR_RATE || 16000);

function levelFor(score) {
  if (score >= 850) return 'Guardian of Bali';
  if (score >= 600) return 'Champion';
  if (score >= 300) return 'Supporter';
  if (score >= 100) return 'Explorer';
  return 'Seedling';
}

const ZERO_SUMMARY = {
  score: 0,
  max_score: MAX_SCORE,
  level: 'Seedling',
  local_pct: 0,
  corp_pct: 0,
  local_amount_idr: 0,
  total_spent_usd: 0,
  local_stays: 0,
  certificates: [],
};

// GET /api/impact/summary — auth optional (guest → zero-state jujur).
const getSummary = async (req, res) => {
  try {
    if (!req.user?.id) return res.json({ success: true, data: ZERO_SUMMARY });

    const { rows } = await pool.query(
      `SELECT
         COALESCE(SUM(p.amount), 0) AS total_usd,
         COALESCE(SUM(CASE WHEN h.is_local_business THEN p.amount ELSE 0 END), 0) AS local_usd,
         COUNT(DISTINCT CASE WHEN h.is_local_business THEN b.id END) AS local_stays
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       JOIN hotels h ON h.id = b.hotel_id
       WHERE p.user_id = $1 AND p.status = 'success'`,
      [req.user.id]
    );

    const totalUsd = Number(rows[0].total_usd);
    const localUsd = Number(rows[0].local_usd);
    const localStays = Number(rows[0].local_stays);
    const localPct = totalUsd > 0 ? Math.round((localUsd / totalUsd) * 100) : 0;
    const score = Math.min(MAX_SCORE, Math.round(localUsd * SCORE_PER_USD));

    // Sertifikat derivasi: satu per hotel lokal dengan riwayat sukses.
    const { rows: certRows } = await pool.query(
      `SELECT h.name, h.location, MAX(b.check_out) AS last_stay
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       JOIN hotels h ON h.id = b.hotel_id
       WHERE p.user_id = $1 AND p.status = 'success' AND h.is_local_business
       GROUP BY h.name, h.location
       ORDER BY last_stay DESC`,
      [req.user.id]
    );

    res.json({
      success: true,
      data: {
        score,
        max_score: MAX_SCORE,
        level: levelFor(score),
        local_pct: localPct,
        corp_pct: totalUsd > 0 ? 100 - localPct : 0,
        local_amount_idr: Math.round(localUsd * USD_TO_IDR_RATE),
        total_spent_usd: totalUsd,
        local_stays: localStays,
        certificates: certRows.map((c) => ({
          name: `Local Stay — ${c.name}`,
          date: c.last_stay ? new Date(c.last_stay).toISOString().slice(0, 10) : null,
          place: c.location,
        })),
      },
    });
  } catch (e) {
    console.error('[impact summary] error:', e.message);
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// GET /api/impact/discovery?limit=&shuffle= — auth optional.
// Anti-algoritma: keluarkan yang sudah di-wishlist/dibooking, utamakan usaha
// lokal + lokasi yang belum pernah dikunjungi user. `shuffle=true` (tombol
// "Guncang untuk Temukan" di Figma) mengacak urutan, filter anti-histori
// tetap berlaku.
const getDiscovery = async (req, res) => {
  try {
    const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 6));
    const shuffle = req.query.shuffle === 'true';
    const userId = req.user?.id || null;

    let excludedIds = [];
    let visitedLocations = [];
    if (userId) {
      const [{ rows: exRows }, { rows: locRows }] = await Promise.all([
        pool.query(
          `SELECT hotel_id AS id FROM wishlist WHERE user_id = $1
           UNION
           SELECT hotel_id AS id FROM bookings WHERE user_id = $1`,
          [userId]
        ),
        pool.query(
          `SELECT DISTINCT h.location FROM bookings b
           JOIN hotels h ON h.id = b.hotel_id
           WHERE b.user_id = $1`,
          [userId]
        ),
      ]);
      excludedIds = exRows.map((r) => r.id);
      visitedLocations = locRows.map((r) => r.location);
    }

    // Ambil lebih banyak dari limit karena sebagian terfilter excludedIds.
    const { rows } = await pool.query(
      `SELECT id, name, location, image, is_local_business, rating
       FROM hotels
       WHERE available = true AND id != ALL($1::uuid[])
       ORDER BY ${shuffle ? 'RANDOM()' : 'is_local_business DESC, rating DESC NULLS LAST'}
       LIMIT $2`,
      [excludedIds, limit + excludedIds.length + 5]
    );

    const data = rows
      .filter((h) => !excludedIds.includes(h.id))
      .slice(0, limit)
      .map((h) => ({
        ...pickDiscovery(h),
        // B2 (Figma "0% Match with Your History"): kandidat sudah
        // difilter dari histori, jadi kecocokan = 0 menurut konstruksi —
        // bukan skor kemiripan yang dihitung.
        match_pct: 0,
        match_note: matchNote(h, visitedLocations, userId),
      }));

    res.json({ success: true, data, meta: { shuffle } });
  } catch (e) {
    console.error('[impact discovery] error:', e.message);
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

function pickDiscovery(h) {
  return { id: h.id, name: h.name, location: h.location, image: h.image };
}

// Penjelasan "kenapa ini beda" — selalu merujuk ke data histori yang nyata.
function matchNote(hotel, visitedLocations, userId) {
  const isNewPlace = hotel.location && !visitedLocations.includes(hotel.location);
  if (!userId) {
    return hotel.is_local_business
      ? `Usaha lokal di ${hotel.location} — mulai dari yang berdampak`
      : 'Jelajahi yang beda dari arus utama';
  }
  if (hotel.is_local_business && isNewPlace) {
    return `Usaha lokal di ${hotel.location} — belum pernah kamu kunjungi`;
  }
  if (hotel.is_local_business) return `Usaha lokal di ${hotel.location} — berdampak langsung`;
  if (isNewPlace) return `Belum pernah ke ${hotel.location} — coba yang baru`;
  return 'Pilihan di luar kebiasaanmu';
}

module.exports = { getSummary, getDiscovery };
