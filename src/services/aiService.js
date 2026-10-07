// src/services/aiService.js
// Semua fitur AI Sasacation, sekarang berbasis RAG (Retrieval-Augmented Generation).
//
// Perbedaan dari versi sebelumnya:
//   - SEBELUM: seluruh data hotel/destinasi/resto di-dump ke prompt setiap kali
//     (boros token, tidak scalable kalau data ratusan/ribuan)
//   - SEKARANG: hanya dokumen yang RELEVAN dengan query yang diambil via
//     similarity search di pgvector, lalu disisipkan ke prompt (jauh lebih
//     ringkas dan akurat, serta scalable untuk data besar)

const pool = require('../config/db');
const { ragRetrieve } = require('./ragService');
const { getUserContext } = require('./userContextService');
const { runTripPlanningAgents } = require('./agentOrchestratorService');

// F.1 cache query populer TTL 1 jam (in-memory, tanpa Redis di MVP).
// Key: query normalized + userId presence (guest vs login dipisah).
const searchCache = new Map();
const SEARCH_CACHE_TTL_MS = 60 * 60 * 1000;
function getCachedSearch(key) {
  const hit = searchCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > SEARCH_CACHE_TTL_MS) { searchCache.delete(key); return null; }
  return { ...hit.value, cached: true };
}
function setCachedSearch(key, value) {
  searchCache.set(key, { at: Date.now(), value });
  if (searchCache.size > 200) {
    const oldest = searchCache.keys().next().value;
    searchCache.delete(oldest);
  }
}

const OLLAMA_URL   = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL    || 'llama3.1:latest';

// ─── Helper: panggil Ollama chat endpoint ───────────────────────────────────
async function ollamaChat(systemPrompt, messages, jsonMode = false) {
  const chatMessages = typeof messages === 'string'
    ? [{ role: 'user', content: messages }]
    : messages;

  const body = {
    model: OLLAMA_MODEL,
    stream: false,
    messages: [{ role: 'system', content: systemPrompt }, ...chatMessages],
    ...(jsonMode && { format: 'json' }),
    options: { temperature: 0.7, num_ctx: 4096, num_predict: 1500 },
  };

  const startedAt = Date.now();
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  console.log(`[ollamaChat] selesai dalam ${((Date.now() - startedAt) / 1000).toFixed(1)}s, status ${res.status}`);

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const errBody = await res.json();
      if (errBody?.error) detail = errBody.error;
    } catch (_) {}
    throw new Error(`Ollama error (${res.status}): ${detail}`);
  }
  const data = await res.json();
  return data.message.content;
}

// ─── 1. CHAT ASSISTANT (RAG + Travel Memory) ─────────────────────────────────
async function chatWithAssistant({ messages, userName, userId }) {
  // Ambil pesan terakhir user sebagai query untuk retrieval
  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content || '';

  console.log(`[RAG Chat] Query: "${lastUserMessage}"`);
  const { docs, context } = await ragRetrieve(lastUserMessage, { topK: 5 });
  console.log(`[RAG Chat] Ditemukan ${docs.length} dokumen relevan`);

  // Konteks user: preferensi + wishlist + riwayat booking (null kalau belum login/belum ada data)
  const userContext = await getUserContext(userId);
  const userContextBlock = userContext
    ? `\n\nYANG KAMU TAHU TENTANG USER INI (pakai untuk personalisasi, JANGAN sebut ulang secara mentah):\n${userContext}`
    : '';

  const systemPrompt = `Kamu adalah Sasa, AI travel assistant untuk aplikasi Sasacation — platform wisata Lombok, Indonesia.

KEPRIBADIAN:
- Ramah, antusias tentang Lombok, dan membantu
- Jawab dalam bahasa yang sama dengan user (Indonesia atau Inggris)
- Berikan rekomendasi spesifik berdasarkan dokumen yang ditemukan di bawah
- Kalau kamu tahu preferensi/riwayat user, gunakan itu secara halus untuk menyesuaikan rekomendasi (misal: hindari saran hiking kalau user tidak suka hiking), tapi jangan membacakan datanya secara verbatim seperti robot

DOKUMEN RELEVAN (hasil pencarian similarity dari database Sasacation):
${context}${userContextBlock}

PANDUAN:
- HANYA gunakan informasi dari dokumen di atas. Jangan mengarang data yang tidak ada.
- Jika dokumen di atas tidak relevan dengan pertanyaan user, katakan dengan jujur bahwa kamu tidak punya info spesifik, lalu berikan saran umum.
- Jika ditanya tentang booking, arahkan user untuk menekan tombol "Book Now" di detail hotel
- User saat ini: ${userName || 'Wisatawan'}`;

  return ollamaChat(systemPrompt, messages);
}

// ─── F.1: parser terstruktur — implementasi kanonis di searchFilterService.js
// (pure, DB-free & ter-unit-test via tests/ai-features.test.js). Adapter di
// bawah mempertahankan bentuk yang dipakai smartSearch:
// { maxPriceUSD, city, amenities, vibe[] (label ID utk display), tripType, weekend }.
const { parseSearchFilters } = require('./searchFilterService');

function extractSearchFilters(query) {
  const pf = parseSearchFilters(query || '');
  return {
    maxPriceUSD: pf.maxPrice,
    city: pf.city,
    amenities: pf.amenities,
    vibe: pf.vibeLabels,
    vibes: pf.vibes,
    tripType: pf.tripType,
    weekend: pf.weekend,
    confidence: pf.confidence,
    needsClarification: pf.needsClarification,
  };
}

// Penjelasan 1 kalimat per hasil — deterministik dari data (grounded, anti
// halusinasi). LLM hanya dipakai untuk interpretation/suggestions.
function buildResultExplanation(meta, type, filters) {
  const bits = [];
  if (meta.price != null) {
    const over = filters.maxPriceUSD != null && type === 'hotel' && Number(meta.price) > filters.maxPriceUSD;
    bits.push(over ? `Harga $${meta.price} (di atas budget)` : `Harga $${meta.price}`);
  }
  if (meta.rating != null) bits.push(`rating ${meta.rating}/5`);
  if (meta.location) bits.push(meta.location);
  if (filters.amenities?.length && type === 'hotel') bits.push(`cocok: ${filters.amenities.join(', ')}`);
  else if (type === 'hotel' && filters.vibe?.length) bits.push(`suasana: ${filters.vibe.join(', ')}`);
  return bits.length ? bits.join(' • ') : (meta.name || 'Hasil relevan');
}

// ─── 2. SMART SEARCH (RAG + filter terstruktur F.1) ──────────────────────────
async function smartSearch({ query, userId = null }) {
  const normalizedKey = `${String(query || '').trim().toLowerCase()}::${userId ? 'u' : 'g'}`;
  const cached = getCachedSearch(normalizedKey);
  if (cached) {
    console.log(`[RAG Search] cache hit: "${query}"`);
    return cached;
  }
  console.log(`[RAG Search] Query: "${query}"`);
  const filters = extractSearchFilters(query || '');

  // Tolak tahun basi (audit planner: tanggal 2023) — jangan biarkan LLM mengarang.
  const staleYear = String(query || '').match(/(19|20)\d{2}/);
  if (staleYear && parseInt(staleYear[0], 10) < new Date().getUTCFullYear() - 1) {
    return {
      interpretation: `Tanggal ${staleYear[0]} sudah lewat — coba sebutkan tanggal relatif seperti "weekend ini" atau bulan/tahun yang valid.`,
      category: 'hotel', suggestions: [], results: [], totalResults: 0,
      appliedFilters: filters, needsClarification: true, staleYear: parseInt(staleYear[0], 10),
    };
  }

  const [{ docs, context }, prefs] = await Promise.all([
    ragRetrieve(query, { topK: 8 }),
    userId ? pool.query('SELECT amenity_prefs, trip_types, styles FROM user_preferences WHERE user_id = $1', [userId]).then(r => r.rows[0] || null).catch(() => null) : Promise.resolve(null),
  ]);
  console.log(`[RAG Search] Ditemukan ${docs.length} dokumen relevan | filter:`, JSON.stringify(filters));

  // Kalau RAG sudah menemukan dokumen relevan, kita bisa langsung kembalikan
  // metadata-nya tanpa perlu LLM sama sekali untuk kasus sederhana.
  // Tapi untuk interpretasi & saran yang lebih natural, tetap panggil LLM.
  const systemPrompt = `Kamu adalah search engine cerdas untuk aplikasi wisata Lombok.
Berdasarkan dokumen yang ditemukan lewat pencarian semantik di bawah, berikan interpretasi singkat.
Balas HANYA dalam format JSON valid:
{
  "interpretation": "penjelasan singkat apa yang user cari, berdasarkan dokumen yang ditemukan",
  "suggestions": ["nama tempat 1 dari dokumen", "nama tempat 2 dari dokumen"]
}`;

  const userMessage = `Query user: "${query}"

Dokumen yang ditemukan lewat RAG similarity search:
${context}

Berikan interpretation dan suggestions berdasarkan dokumen di atas.`;

  const raw = await ollamaChat(systemPrompt, userMessage, true);
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(cleaned);

  // Terapkan filter budget ke hotel (destinasi/restoran tidak difilter harga
  // menginap). Hotel di atas budget DIBUANG agar ranking jujur; kalau semua
  // habis terfilter, kembalikan semua + flag needsClarification.
  let kept = docs;
  if (filters.maxPriceUSD != null) {
    const inBudget = docs.filter(d =>
      d.doc_type !== 'hotel' || Number(d.metadata?.price) <= filters.maxPriceUSD);
    if (inBudget.length > 0) kept = inBudget;
  }

  // Hybrid SQL: filter kota/harga/amenitas langsung ke tabel hotels,
  // gabung dengan hasil RAG (dedup by id). Menutup gap "hanya similarity".
  try {
    const conds = ['available = true'];
    const params = [];
    if (filters.maxPriceUSD != null) { params.push(Number(filters.maxPriceUSD)); conds.push(`price <= $${params.length}`); }
    if (filters.city) { params.push(`%${filters.city}%`); conds.push(`(name ILIKE $${params.length} OR location ILIKE $${params.length})`); }
    if (filters.amenities?.length) {
      // mapping keyword → frasa amenities: bathtub→Bathtub, pool→Pool, dst.
      const want = filters.amenities.map((a) => a.toLowerCase());
      const likeConds = [];
      for (const w of want.slice(0, 5)) { params.push(`%${w}%`); likeConds.push(`amenities::text ILIKE $${params.length}`); }
      if (likeConds.length) conds.push(`(${likeConds.join(' OR ')})`);
    }
    if (conds.length > 1) {
      const { rows } = await pool.query(
        `SELECT id, name, location, price, rating, image, description, amenities FROM hotels WHERE ${conds.join(' AND ')} ORDER BY rating DESC NULLS LAST LIMIT 10`,
        params
      );
      const seen = new Set(kept.map((d) => String(d.doc_id || d.metadata?.id)));
      for (const h of rows) {
        if (seen.has(String(h.id))) continue;
        kept.push({ doc_id: String(h.id), doc_type: 'hotel', similarity: 0.5, metadata: { id: h.id, name: h.name, location: h.location, price: h.price, rating: h.rating, image: h.image, description: h.description, amenities: h.amenities }, sqlMatch: true });
      }
    }
  } catch (e) {
    console.error('[RAG Search] SQL hybrid gagal (fail-soft):', e.message);
  }

  // Boost vibe: +0.1 per vibe cocok dari hotel_vibes + personalisasi prefs.
  let vibeMap = {};
  try {
    const ids = kept.filter((d) => d.doc_type === 'hotel').map((d) => String(d.doc_id || d.metadata?.id)).filter(Boolean);
    if (ids.length) {
      const { rows } = await pool.query('SELECT hotel_id, vibe FROM hotel_vibes WHERE hotel_id = ANY($1::uuid[])', [ids]).catch(() => ({ rows: [] }));
      for (const r of rows) { (vibeMap[r.hotel_id] = vibeMap[r.hotel_id] || []).push(r.vibe); }
    }
  } catch (_) { /* tabel belum dimigrasi → skip boost */ }
  const vibeQuery = new Set([...(filters.vibe || []), ...((prefs?.trip_types || []).map((t) => String(t).toLowerCase()))]);
  // normalisasi: tenang→quiet? mapping longgar ID→EN
  const vibeAlias = { tenang: 'quiet', romantis: 'romantic', mewah: 'luxury', murah: 'budget', keluarga: 'family' };
  const wantVibes = new Set([...vibeQuery].map((v) => vibeAlias[v] || v));

  // Kembalikan hasil RAG (metadata dokumen asli) + interpretasi dari LLM.
  // Tambahan F.1 (backward compatible — FE lama mengabaikan field baru):
  // appliedFilters, needsClarification, dan per-item {score, explanation}.
  const emptyResult = kept.length === 0;
  const result = {
    interpretation: parsed.interpretation || `Hasil pencarian untuk: ${query}`,
    category: 'hotel',
    suggestions: parsed.suggestions || [],
    // Ini bagian pentingnya — hasil RETRIEVAL langsung dari pgvector,
    // bukan dari LLM. Jadi datanya selalu akurat sesuai database.
    results: kept.map(d => {
      const hid = String(d.doc_id || d.metadata?.id || '');
      const hv = vibeMap[hid] || [];
      const vibeHit = hv.filter((v) => wantVibes.has(v)).length;
      const prefHit = prefs?.amenity_prefs?.length && Array.isArray(d.metadata?.amenities)
        ? d.metadata.amenities.filter((a) => prefs.amenity_prefs.some((p) => String(a).toLowerCase().includes(String(p).toLowerCase()))).length : 0;
      const base = Number(d.similarity || 0);
      const score = Number(Math.min(1, base + vibeHit * 0.1 + (d.sqlMatch ? 0.05 : 0) + Math.min(0.1, (prefHit || 0) * 0.05)).toFixed(3));
      return {
        ...d.metadata,
        type: d.doc_type,
        similarity: d.similarity,
        score,
        vibes: hv,
        explanation: buildResultExplanation(d.metadata || {}, d.doc_type, filters) + (vibeHit ? ` • vibe: ${hv.join(', ')}` : ''),
      };
    }).sort((a, b) => b.score - a.score),
    totalResults: kept.length,
    appliedFilters: filters,
    needsClarification: emptyResult || (filters.maxPriceUSD == null && filters.city == null && filters.amenities.length === 0),
  };
  if (!emptyResult) setCachedSearch(normalizedKey, result);
  return result;
}

// ─── 3. AUTO-GENERATE DESKRIPSI (RAG untuk konsistensi gaya) ─────────────────
async function generateDescription({ type, name, location, amenities, price, rating }) {
  const typeLabel = type === 'hotel' ? 'hotel' : type === 'destination' ? 'destinasi wisata' : 'restoran';

  // RAG di sini dipakai untuk mengambil contoh deskripsi serupa yang sudah ada,
  // supaya gaya bahasa deskripsi baru konsisten dengan yang lama.
  const searchQuery = `${typeLabel} di ${location}`;
  const { docs } = await ragRetrieve(searchQuery, { topK: 2, docType: type === 'hotel' ? 'hotel' : type === 'destination' ? 'destination' : 'restaurant' });

  const exampleStyle = docs.length > 0
    ? `\n\nContoh gaya deskripsi yang sudah ada di Sasacation (untuk referensi tone & gaya):\n${docs.map(d => d.content.split('Deskripsi: ')[1] || '').filter(Boolean).join('\n---\n')}`
    : '';

  const systemPrompt = `Kamu adalah copywriter profesional untuk platform wisata Lombok.
Tulis deskripsi yang menarik, informatif, dan membuat wisatawan tertarik.
Gunakan bahasa Indonesia yang natural. Panjang 2-3 paragraf.
JANGAN gunakan kalimat generik. Fokus pada keunikan tempat tersebut.${exampleStyle}`;

  const userMessage = `Buat deskripsi untuk ${typeLabel} berikut:
Nama: ${name}
Lokasi: ${location}
${amenities?.length ? `Fasilitas: ${amenities.join(', ')}` : ''}
${price ? `Harga: $${price}` : ''}
${rating ? `Rating: ${rating}/5` : ''}

Tulis deskripsi yang memukau, dengan gaya konsisten seperti contoh di atas jika ada!`;

  return ollamaChat(systemPrompt, userMessage);
}

// ─── 4. TRIP PLANNER (sekarang Agent-Based Workflow) ──────────────────────────
// SEBELUM: satu prompt raksasa berisi semua dokumen RAG mentah, LLM disuruh
// pilih & susun sekaligus dalam satu langkah.
// SEKARANG: dipecah jadi beberapa agent bertanggung jawab sempit (Hotel,
// Restaurant, Activity, Budget, Itinerary Composer) yang dijalankan
// agentOrchestratorService — lihat file itu untuk detail alurnya.
//
// PENTING: signature & return shape function ini SENGAJA dipertahankan
// identik dengan versi lama (generateTripPlan({ duration, budget, interests,
// startDate, groupType, userId }) → TripPlan JSON), supaya aiController.js
// dan app Flutter TIDAK PERLU berubah sama sekali untuk endpoint /ai/trip-plan
// yang sudah ada. Semua kerumitan baru ada di dalam, kontraknya tetap sama.
async function generateTripPlan(params) {
  return runTripPlanningAgents(params);
}

module.exports = { chatWithAssistant, smartSearch, generateDescription, generateTripPlan };
