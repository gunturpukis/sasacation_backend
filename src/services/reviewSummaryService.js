// src/services/reviewSummaryService.js
// F.2 AI Review Summary — MVP deterministik (tanpa LLM call per-request).
//
// Kenapa deterministik dulu, bukan LLM?
// 1. Latensi Ollama lokal 120s+ tidak cocok untuk endpoint sinkron.
// 2. Pros/cons dari keyword frequency itu grounded (anti halusinasi) —
//    LLM hanya akan dipakai nanti untuk kalimat `summary_text` yang fancier.
// 3. Cache di tabel review_summaries: hitung 1x, sajikan berkali-kali.
//
// Kapan recompute: cache miss, review_count berubah, atau updated_at > 7 hari.

const pool = require('../config/db');

const PROS_KEYWORDS = [
  [/bersih|clean/i, 'Kamar bersih'],
  [/ramah|friendly|staff|pelayanan/i, 'Staff ramah'],
  [/lokasi|location|strategis|dekat/i, 'Lokasi strategis'],
  [/sarapan|breakfast/i, 'Breakfast bagus'],
  [/kolam|pool/i, 'Kolam renang bagus'],
  [/nyaman|comfortable|nyenyak/i, 'Menginap nyaman'],
  [/makanan|food|restoran|resto/i, 'Makanan enak'],
  [/view|pemandangan|pantai|beach/i, 'Pemandangan bagus'],
];

const CONS_KEYWORDS = [
  [/wifi|internet|sinyal/i, 'WiFi bermasalah di beberapa kamar'],
  [/parkir|parking/i, 'Parkir terbatas'],
  [/bising|berisik|suara|noise|koridor/i, 'Suara dari koridor'],
  [/sempit|kecil/i, 'Kamar terasa sempit'],
  [/mahal|expensive/i, 'Harga terasa mahal'],
  [/kotor|dirty/i, 'Kebersihan perlu ditingkatkan'],
  [/lambat|slow|lama/i, 'Pelayanan lambat'],
  [/ac\b|panas|dingin/i, 'AC/kamar bermasalah'],
];

function extractAspects(texts, rules, topN = 3) {
  const hits = [];
  for (const [re, label] of rules) {
    let count = 0;
    for (const t of texts) if (re.test(t)) count++;
    if (count > 0) hits.push({ label, count });
  }
  hits.sort((a, b) => b.count - a.count);
  return hits.slice(0, topN).map(h => h.label);
}

async function getOrBuildSummary(hotelId) {
  // 1. Cek cache segar: count sama + umur < 7 hari
  const { rows: hotels } = await pool.query(
    'SELECT rating FROM hotels WHERE id = $1',
    [hotelId]
  );
  if (hotels.length === 0) return null;

  let cached = null;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM review_summaries WHERE hotel_id = $1',
      [hotelId]
    );
    cached = rows[0] || null;
  } catch (e) {
    if (e.code !== '42P01') throw e; // selain tabel belum ada → hitung tanpa cache
  }

  let reviews = [];
  try {
    const { rows } = await pool.query(
      `SELECT rating, text FROM reviews
       WHERE hotel_id = $1 AND text IS NOT NULL AND text <> ''
       ORDER BY created_at DESC LIMIT 200`,
      [hotelId]
    );
    reviews = rows;
  } catch (e) {
    if (e.code !== '42P01') throw e;
  }

  const fresh =
    cached &&
    Number(cached.review_count) === reviews.length &&
    Date.now() - new Date(cached.updated_at).getTime() < 7 * 24 * 3600 * 1000;
  if (fresh) return cached;

  // 2. Hitung ulang (deterministik)
  const count = reviews.length;
  const avg = count
    ? Number((reviews.reduce((s, r) => s + Number(r.rating || 0), 0) / count).toFixed(2))
    : null;
  const texts = reviews.map(r => r.text);
  const pros = extractAspects(texts, PROS_KEYWORDS);
  const cons = extractAspects(texts, CONS_KEYWORDS);
  const summaryText = count === 0
    ? 'Belum ada review yang bisa diringkas.'
    : `Dari ${count} ulasan, tamu paling sering memuji ${pros.length ? pros.join(', ').toLowerCase() : 'pengalaman menginap secara umum'}` +
      (cons.length ? `, dengan keluhan terbanyak soal ${cons.join(', ').toLowerCase()}.` : '.');

  // 3. Upsert cache (fail-soft bila tabel belum dimigrasi)
  try {
    const { rows } = await pool.query(
      `INSERT INTO review_summaries (hotel_id, pros, cons, avg_rating, review_count, summary_text, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (hotel_id) DO UPDATE SET
         pros = EXCLUDED.pros, cons = EXCLUDED.cons,
         avg_rating = EXCLUDED.avg_rating, review_count = EXCLUDED.review_count,
         summary_text = EXCLUDED.summary_text, updated_at = NOW()
       RETURNING *`,
      [hotelId, pros, cons, avg, count, summaryText]
    );
    return rows[0];
  } catch (e) {
    if (e.code === '42P01') {
      return { hotel_id: hotelId, pros, cons, avg_rating: avg, review_count: count, summary_text: summaryText, updated_at: new Date() };
    }
    throw e;
  }
}

// Baris personal: cocokkan minat user (dari preferences) dengan pros hotel.
// Contoh: minat "kuliner" + pros "Makanan enak" → "Untuk kamu, ...".
function buildPersonalizedLine(summary, prefs) {
  if (!summary || !prefs) return null;
  const interests = [...(prefs.interests || []), ...(prefs.styles || [])].map(s => String(s).toLowerCase());
  if (!interests.length || !summary.pros?.length) return null;
  const match = summary.pros.find(p => interests.some(i => p.toLowerCase().includes(i) || i.includes(p.toLowerCase().split(' ')[0])));
  if (match) return `Untuk kamu, ulasan paling relevan membahas: ${match.toLowerCase()}.`;
  return `Untuk kamu, ${summary.review_count} ulasan memberi rating rata-rata ${summary.avg_rating ?? '-'}.`;
}

module.exports = { getOrBuildSummary, buildPersonalizedLine, extractAspects, PROS_KEYWORDS, CONS_KEYWORDS };
