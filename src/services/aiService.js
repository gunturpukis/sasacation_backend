// src/services/aiService.js — versi Ollama lokal
const db = require('../config/database');
 
const OLLAMA_URL   = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL    || 'qwen2.5:7b';
 
// ─── Helper: panggil Ollama chat endpoint ───────────────────────────────────
// `messages` boleh berupa string (satu pesan user) ATAU array [{role, content}]
// supaya bisa dipakai untuk chat multi-turn (chatWithAssistant) maupun
// satu-kali prompt (smartSearch, generateDescription, generateTripPlan).
async function ollamaChat(systemPrompt, messages, jsonMode = false) {
  const chatMessages = typeof messages === 'string'
    ? [{ role: 'user', content: messages }]
    : messages;
 
  const body = {
    model: OLLAMA_MODEL,
    stream: false,
    messages: [
      { role: 'system', content: systemPrompt },
      ...chatMessages,
    ],
    ...(jsonMode && { format: 'json' }),
    options: { temperature: 0.7, num_ctx: 4096 },
  };
 
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
 
  if (!res.ok) {
    // Ollama biasanya mengirim pesan spesifik di body (mis. "model 'x' not
    // found, try pulling it first") — jauh lebih berguna daripada statusText
    // generik ("Not Found") saat debugging.
    let detail = res.statusText;
    try {
      const errBody = await res.json();
      if (errBody?.error) detail = errBody.error;
    } catch (_) {
      // body bukan JSON / kosong, biarkan pakai statusText
    }
    throw new Error(`Ollama error (${res.status}): ${detail}`);
  }
  const data = await res.json();
  return data.message.content;
}
 
// ─── Build context string dari database ─────────────────────────────────────
function buildDestinationContext() {
  const hotels = db.hotels.map(h =>
    `Hotel: ${h.name} | Lokasi: ${h.location} | Harga: $${h.price}/malam | Rating: ${h.rating} | Fasilitas: ${h.amenities.join(', ')}`
  ).join('\n');
 
  const destinations = db.destinations.map(d =>
    `Destinasi: ${d.name} | Lokasi: ${d.location} | Kategori: ${d.subCategory} | Rating: ${d.rating} | ${d.description?.slice(0, 100)}...`
  ).join('\n');
 
  const restaurants = db.restaurants.map(r =>
    `Restoran: ${r.name} | Lokasi: ${r.location} | Masakan: ${r.cuisine} | Harga rata-rata: $${r.price} | Jam buka: ${r.openHours}`
  ).join('\n');
 
  return `
=== DATA HOTEL LOMBOK ===
${hotels}
 
=== DESTINASI WISATA LOMBOK ===
${destinations}
 
=== KULINER LOMBOK ===
${restaurants}
 
=== KATEGORI WISATA ===
Beaches (Pantai), Hotels, Culinary (Kuliner), Islands (Pulau Gili), Adventure (Petualangan Rinjani), Culture (Budaya Sasak)
`.trim();
}
 
// ─── 1. CHAT ASSISTANT ───────────────────────────────────────────────────────
async function chatWithAssistant({ messages, userName }) {
  const context = buildDestinationContext();
  const systemPrompt = `Kamu adalah Sasa, AI travel assistant untuk aplikasi Sasacation — platform wisata Lombok, Indonesia.
 
KEPRIBADIAN:
- Ramah, antusias tentang Lombok, dan membantu
- Jawab dalam bahasa yang sama dengan user (Indonesia atau Inggris)
- Berikan rekomendasi spesifik berdasarkan data yang ada
- Selalu mention harga, rating, atau detail relevan jika tersedia
 
DATA REAL-TIME SASACATION:
${context}
 
PANDUAN:
- Rekomendasikan tempat dari data di atas jika relevan
- Jika ditanya tentang booking, arahkan user untuk menekan tombol "Book Now" di detail hotel
- Jangan mengarang data yang tidak ada di atas
- User saat ini: ${userName || 'Wisatawan'}`;
 
  // Kirim seluruh riwayat percakapan (multi-turn), bukan cuma pesan terakhir.
  return ollamaChat(systemPrompt, messages);
}
 
// ─── 2. SMART SEARCH ─────────────────────────────────────────────────────────
async function smartSearch({ query }) {
  const context = buildDestinationContext();
 
  const systemPrompt = `Kamu adalah search engine cerdas untuk aplikasi wisata Lombok.
Berikan respons HANYA dalam format JSON valid berikut, tanpa teks lain:
{
  "interpretation": "penjelasan singkat apa yang user cari",
  "category": "Hotels|Destinations|Culinary|Beaches|Islands|Adventure|Culture|All",
  "filters": {
    "minPrice": null,
    "maxPrice": null,
    "minRating": null
  },
  "suggestions": ["nama tempat 1", "nama tempat 2"],
  "searchQuery": "kata kunci untuk filter database"
}
 
ATURAN PENTING:
- "category" WAJIB berisi TEPAT SATU nilai dari daftar di atas (contoh: "Hotels"), JANGAN pernah menggabungkan beberapa kategori dengan "|" atau koma. Kalau query menyentuh beberapa kategori sekaligus, pilih kategori yang paling dominan, atau gunakan "All".
- "searchQuery" WAJIB berupa 1-2 kata kunci pendek (nama tempat, lokasi, atau jenis makanan/aktivitas spesifik), BUKAN kalimat penuh dari user. Contoh benar: "pantai", "senggigi", "seafood". Contoh SALAH: "hotel murah dekat pantai".
- Kalau tidak ada kata kunci spesifik yang bisa diekstrak (query hanya berisi kata umum seperti "murah", "bagus", "rekomendasi"), kosongkan "searchQuery" (string kosong ""), dan biarkan filter kategori/harga/rating yang bekerja.
- Kata seperti "murah" masuk ke filters.maxPrice (estimasikan angka wajar), BUKAN ke searchQuery.`;
 
  const userMessage = `Query user: "${query}"\n\nData tersedia:\n${context}\n\nParse query ini menjadi filter pencarian.`;
 
  const raw = await ollamaChat(systemPrompt, userMessage, true);
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(cleaned);
 
  // Jaring pengaman: model kadang masih menggabungkan kategori dengan "|"/","
  // meski sudah dilarang di prompt. Ambil token pertama saja supaya tetap
  // valid dipakai sebagai key di catMap pada controller.
  if (typeof parsed.category === 'string' && /[|,]/.test(parsed.category)) {
    parsed.category = parsed.category.split(/[|,]/)[0].trim();
  }
  // Kalau searchQuery ternyata masih berupa kalimat panjang (>3 kata), ini
  // kemungkinan besar bukan keyword — kosongkan supaya controller tidak
  // over-filter jadi 0 hasil. Filter kategori/harga/rating tetap jalan.
  if (typeof parsed.searchQuery === 'string' && parsed.searchQuery.trim().split(/\s+/).length > 3) {
    parsed.searchQuery = '';
  }
 
  return parsed;
}
 
// ─── 3. AUTO-GENERATE DESKRIPSI ──────────────────────────────────────────────
async function generateDescription({ type, name, location, amenities, price, rating }) {
  const typeLabel = type === 'hotel' ? 'hotel' : type === 'destination' ? 'destinasi wisata' : 'restoran';
 
  const systemPrompt = `Kamu adalah copywriter profesional untuk platform wisata Lombok.
Tulis deskripsi yang menarik, informatif, dan membuat wisatawan tertarik mengunjungi tempat tersebut.
Gunakan bahasa Indonesia yang natural dan memikat. Panjang 2-3 paragraf.
JANGAN gunakan kalimat generik. Fokus pada keunikan dan daya tarik spesifik tempat tersebut.`;
 
  const userMessage = `Buat deskripsi untuk ${typeLabel} berikut:
Nama: ${name}
Lokasi: ${location}
${amenities?.length ? `Fasilitas: ${amenities.join(', ')}` : ''}
${price ? `Harga: $${price}` : ''}
${rating ? `Rating: ${rating}/5` : ''}
 
Tulis deskripsi yang memukau!`;
 
  return ollamaChat(systemPrompt, userMessage);
}
 
// ─── 4. TRIP PLANNER ─────────────────────────────────────────────────────────
async function generateTripPlan({ duration, budget, interests, startDate, groupType }) {
  const context = buildDestinationContext();
 
  const systemPrompt = `Kamu adalah trip planner expert untuk Lombok, Indonesia.
Buat itinerary HANYA dalam format JSON valid berikut, tanpa teks lain:
{
  "title": "judul perjalanan",
  "summary": "ringkasan singkat perjalanan",
  "totalEstimatedCost": 0,
  "days": [
    {
      "day": 1,
      "date": "tanggal",
      "title": "tema hari ini",
      "activities": [
        {
          "time": "08:00",
          "name": "nama tempat/aktivitas",
          "type": "hotel|destination|restaurant|transport",
          "location": "lokasi",
          "duration": "2 jam",
          "estimatedCost": 0,
          "notes": "tips atau catatan",
          "itemId": "id dari database jika ada, null jika tidak"
        }
      ],
      "dailyCost": 0
    }
  ],
  "tips": ["tip 1", "tip 2", "tip 3"],
  "bestTimeToVisit": "penjelasan waktu terbaik"
}`;
 
  const userMessage = `Buat itinerary Lombok untuk:
- Durasi: ${duration} hari
- Budget: $${budget} per orang
- Minat: ${interests.join(', ')}
- Tanggal mulai: ${startDate || 'fleksibel'}
- Tipe grup: ${groupType || 'couple'}
 
Data hotel, destinasi, dan restoran yang tersedia:
${context}
 
Prioritaskan tempat dari data di atas. Buat itinerary yang realistis dan detail.`;
 
  const raw = await ollamaChat(systemPrompt, userMessage, true);
  const cleaned = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}
 
module.exports = { chatWithAssistant, smartSearch, generateDescription, generateTripPlan };