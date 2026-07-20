// src/services/aiService.js
// Semua fitur AI Sasacation, sekarang berbasis RAG (Retrieval-Augmented Generation).
//
// Perbedaan dari versi sebelumnya:
//   - SEBELUM: seluruh data hotel/destinasi/resto di-dump ke prompt setiap kali
//     (boros token, tidak scalable kalau data ratusan/ribuan)
//   - SEKARANG: hanya dokumen yang RELEVAN dengan query yang diambil via
//     similarity search di pgvector, lalu disisipkan ke prompt (jauh lebih
//     ringkas dan akurat, serta scalable untuk data besar)

const { ragRetrieve } = require('./ragService');
const { getUserContext } = require('./userContextService');
const { extractJsonObject } = require('./jsonExtractor');

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

// ─── 2. SMART SEARCH (RAG) ────────────────────────────────────────────────────
async function smartSearch({ query }) {
  console.log(`[RAG Search] Query: "${query}"`);
  const { docs, context } = await ragRetrieve(query, { topK: 8 });
  console.log(`[RAG Search] Ditemukan ${docs.length} dokumen relevan`);

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

  // Kembalikan hasil RAG (metadata dokumen asli) + interpretasi dari LLM
  return {
    interpretation: parsed.interpretation || `Hasil pencarian untuk: ${query}`,
    suggestions: parsed.suggestions || [],
    // Ini bagian pentingnya — hasil RETRIEVAL langsung dari pgvector,
    // bukan dari LLM. Jadi datanya selalu akurat sesuai database.
    results: docs.map(d => ({ ...d.metadata, type: d.doc_type, similarity: d.similarity })),
    totalResults: docs.length,
  };
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

// ─── 4. TRIP PLANNER (RAG multi-query + Travel Memory) ────────────────────────
async function generateTripPlan({ duration, budget, interests, startDate, groupType, userId }) {
  console.log(`[RAG Trip Plan] Interests: ${interests.join(', ')}`);

  // Kalau user punya dislikes tersimpan, tambahkan sebagai constraint eksplisit —
  // ini yang paling penting: trip planner generik tidak tahu user benci hiking,
  // trip planner dengan memory tahu dan otomatis menghindarinya.
  const userContext = await getUserContext(userId);
  const userContextBlock = userContext
    ? `\n\nKONTEKS TAMBAHAN TENTANG USER (pertimbangkan saat menyusun itinerary, terutama bagian "Tidak suka" — JANGAN masukkan aktivitas yang sesuai dengan dislikes):\n${userContext}`
    : '';

  // Retrieve dokumen relevan untuk SETIAP interest secara terpisah,
  // supaya semua kategori yang diminta user terwakili di context.
  // Ini penting: kalau cuma 1 query gabungan, hasil retrieval bisa bias
  // ke satu kategori yang paling dominan secara semantik.
  const allDocs = [];
  const seenIds = new Set();

  for (const interest of interests) {
    const { docs } = await ragRetrieve(`wisata ${interest} Lombok`, { topK: 4 });
    for (const doc of docs) {
      if (!seenIds.has(doc.doc_id)) {
        seenIds.add(doc.doc_id);
        allDocs.push(doc);
      }
    }
  }

  // Tambahan: retrieve hotel secara eksplisit untuk akomodasi
  const { docs: hotelDocs } = await ragRetrieve(`hotel penginapan budget ${budget}`, { topK: 3, docType: 'hotel' });
  for (const doc of hotelDocs) {
    if (!seenIds.has(doc.doc_id)) {
      seenIds.add(doc.doc_id);
      allDocs.push(doc);
    }
  }

  console.log(`[RAG Trip Plan] Total dokumen unik terkumpul: ${allDocs.length}`);
  const context = allDocs.map(d => d.content).join('\n\n---\n\n');

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
          "itemId": "id dari dokumen jika ada, null jika tidak"
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

Dokumen tempat yang relevan (hasil RAG similarity search berdasarkan minat user):
${context}${userContextBlock}

Prioritaskan tempat dari dokumen di atas — semuanya sudah difilter relevan dengan minat user.
Balas HANYA dengan objek JSON, tanpa teks tambahan.`;

  const raw = await ollamaChat(systemPrompt, userMessage, false);
  return extractJsonObject(raw);
}

module.exports = { chatWithAssistant, smartSearch, generateDescription, generateTripPlan };
