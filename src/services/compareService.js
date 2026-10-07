// src/services/compareService.js
// F.3 AI Hotel Compare — matriks grounded + verdict LLM.
//
// Prinsip anti-halusinasi: SEMUA angka/boolean matriks dihitung deterministik
// dari DB (hotels + review_summaries). LLM hanya merangkai `verdict` 2–3
// kalimat dan `tradeoffs` dari matriks yang sudah jadi — tidak boleh mengarang
// skor. Kalau LLM gagal/timeout → fallback template deterministik.

const pool = require('../config/db');
const { getOrBuildSummary } = require('./reviewSummaryService');

const OLLAMA_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:latest';

async function ollamaChat(systemPrompt, userMessage) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      options: { temperature: 0.5, num_ctx: 4096, num_predict: 400 },
    }),
  });
  if (!res.ok) throw new Error(`Ollama error (${res.status})`);
  const data = await res.json();
  return data.message.content;
}

function hasAmenity(amenities, keys) {
  const a = (amenities || []).map(x => String(x).toLowerCase());
  return keys.some(k => a.some(x => x.includes(k)));
}

// Heuristik v1 yang jujur (terdokumentasi, bukan karangan LLM):
// - locationScore: 5 bila pros memuat "Lokasi", 4 bila rating >= 4.5, else 3
// - roomScore: 5 bila pros memuat bersih+nyaman, 4 bila salah satu, else 3
// - coupleFit: 5 bila ada bathtub/romantis, 4 bila pool+rating>=4.5, else 3
// - value: rating*2 dibulatkan 1 desimal (skala 10), cap 10
function buildRow(hotel, summary) {
  const amenities = hotel.amenities || [];
  const pros = summary?.pros || [];
  const has = (s) => pros.some(p => p.toLowerCase().includes(s));
  const rating = Number(hotel.rating) || 0;
  const locationScore = has('lokasi') ? 5 : rating >= 4.5 ? 4 : 3;
  const roomScore = has('bersih') && has('nyaman') ? 5 : (has('bersih') || has('nyaman')) ? 4 : 3;
  const breakfast = hasAmenity(amenities, ['breakfast', 'sarapan']);
  const pool = hasAmenity(amenities, ['pool', 'kolam']);
  const coupleFit = hasAmenity(amenities, ['bathtub', 'bath tub', 'spa', 'romantis']) || has('romantis')
    ? 5 : (pool && rating >= 4.5 ? 4 : 3);
  const value = Math.min(10, Math.round(rating * 2 * 10) / 10);
  return {
    hotelId: hotel.id,
    name: hotel.name,
    price: Number(hotel.price),
    locationScore, roomScore, breakfast, pool, coupleFit, value,
    rating,
  };
}

function buildTradeoffs(rows) {
  return rows.map(r => {
    const bits = [];
    if (r.locationScore >= 5) bits.push('lokasi terbaik');
    if (r.roomScore >= 5) bits.push('kamar terbersih/nyaman');
    if (r.coupleFit >= 5) bits.push('paling cocok untuk pasangan');
    if (r.price === Math.min(...rows.map(x => x.price))) bits.push('termurah');
    if (r.price === Math.max(...rows.map(x => x.price))) bits.push('termahal');
    return `${r.name}: ${bits.length ? bits.join(', ') : `rating ${r.rating}/5`}`;
  });
}

function fallbackVerdict(rows, profile) {
  const sorted = [...rows].sort((a, b) => b.value - a.value || a.price - b.price);
  const top = sorted[0];
  const whyProfile = profile?.tripTypes?.length
    ? ` untuk trip ${profile.tripTypes.join(', ')}`
    : '';
  return `Saya merekomendasikan ${top.name}${whyProfile} — value ${top.value}/10 dengan rating ${top.rating}/5. ` +
    (sorted[1]
      ? `${sorted[1].name} jadi alternatif ${sorted[1].price < top.price ? 'lebih hemat' : 'dengan trade-off berbeda'}.`
      : '');
}

async function compareHotels(hotelIds, userId) {
  const unique = [...new Set(hotelIds)].slice(0, 3);
  if (unique.length < 2)
    throw Object.assign(new Error('Bandingkan minimal 2 hotel (maksimal 3).'), { status: 400 });

  const { rows: hotels } = await pool.query(
    'SELECT id, name, location, price, rating, amenities FROM hotels WHERE id = ANY($1::uuid[])',
    [unique]
  );
  if (hotels.length < 2)
    throw Object.assign(new Error('Hotel tidak ditemukan.'), { status: 404 });

  // Urutkan sesuai urutan input user
  const order = new Map(unique.map((id, i) => [String(id), i]));
  hotels.sort((a, b) => (order.get(String(a.id)) ?? 0) - (order.get(String(b.id)) ?? 0));

  const matrix = [];
  for (const h of hotels) {
    const summary = await getOrBuildSummary(h.id);
    matrix.push(buildRow(h, summary));
  }
  const tradeoffs = buildTradeoffs(matrix);

  let profile = null;
  if (userId) {
    try {
      const { rows } = await pool.query('SELECT * FROM user_preferences WHERE user_id = $1', [userId]);
      profile = rows[0] || null;
    } catch (_) { /* fail-soft */ }
  }

  // Verdict via LLM (grounded pada matriks) — fallback template bila gagal
  let verdict;
  try {
    const system = 'Kamu adalah asisten travel Sasacation. Berikan rekomendasi hotel 2-3 kalimat dalam Bahasa Indonesia, HANYA berdasarkan matriks JSON berikut. Jangan mengarang angka di luar matriks.';
    const user = `Matriks:\n${JSON.stringify(matrix)}\nTrade-offs:\n${tradeoffs.join('\n')}` +
      (profile ? `\nProfil user: ${JSON.stringify({ tripTypes: profile.preferred_group_type, styles: profile.styles, interests: profile.interests })}` : '') +
      '\nHotel mana yang paling direkomendasikan dan kenapa?';
    verdict = (await ollamaChat(system, user)).trim();
  } catch (e) {
    console.error('[compare] LLM verdict gagal, pakai fallback:', e.message);
    verdict = fallbackVerdict(matrix, profile ? { tripTypes: profile.preferred_group_type ? [profile.preferred_group_type] : [] } : null);
  }

  return { matrix, verdict, tradeoffs };
}

module.exports = { compareHotels, buildRow, buildTradeoffs, fallbackVerdict };
