// const Anthropic = require('@anthropic-ai/sdk');
// const db = require('../config/database');

// const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
// const MODEL = 'claude-opus-4-5';

// // ─── Build context string dari database ─────────────────────────────────────
// function buildDestinationContext() {
//   const hotels = db.hotels.map(h =>
//     `Hotel: ${h.name} | Lokasi: ${h.location} | Harga: $${h.price}/malam | Rating: ${h.rating} | Fasilitas: ${h.amenities.join(', ')}`
//   ).join('\n');

//   const destinations = db.destinations.map(d =>
//     `Destinasi: ${d.name} | Lokasi: ${d.location} | Kategori: ${d.subCategory} | Rating: ${d.rating} | ${d.description?.slice(0, 100)}...`
//   ).join('\n');

//   const restaurants = db.restaurants.map(r =>
//     `Restoran: ${r.name} | Lokasi: ${r.location} | Masakan: ${r.cuisine} | Harga rata-rata: $${r.price} | Jam buka: ${r.openHours}`
//   ).join('\n');

//   return `
// === DATA HOTEL LOMBOK ===
// ${hotels}

// === DESTINASI WISATA LOMBOK ===
// ${destinations}

// === KULINER LOMBOK ===
// ${restaurants}

// === KATEGORI WISATA ===
// Beaches (Pantai), Hotels, Culinary (Kuliner), Islands (Pulau Gili), Adventure (Petualangan Rinjani), Culture (Budaya Sasak)
// `.trim();
// }

// // ─── 1. CHAT ASSISTANT ───────────────────────────────────────────────────────
// async function chatWithAssistant({ messages, userName }) {
//   const context = buildDestinationContext();
//   const systemPrompt = `Kamu adalah Sasa, AI travel assistant untuk aplikasi Sasacation — platform wisata Lombok, Indonesia.

// KEPRIBADIAN:
// - Ramah, antusias tentang Lombok, dan membantu
// - Jawab dalam bahasa yang sama dengan user (Indonesia atau Inggris)
// - Berikan rekomendasi spesifik berdasarkan data yang ada
// - Selalu mention harga, rating, atau detail relevan jika tersedia

// DATA REAL-TIME SASACATION:
// ${context}

// PANDUAN:
// - Rekomendasikan tempat dari data di atas jika relevan
// - Jika ditanya tentang booking, arahkan user untuk menekan tombol "Book Now" di detail hotel
// - Jangan mengarang data yang tidak ada di atas
// - User saat ini: ${userName || 'Wisatawan'}`;

//   const response = await client.messages.create({
//     model: MODEL,
//     max_tokens: 1024,
//     system: systemPrompt,
//     messages: messages.map(m => ({ role: m.role, content: m.content })),
//   });

//   return response.content[0].text;
// }

// // ─── 2. SMART SEARCH ─────────────────────────────────────────────────────────
// async function smartSearch({ query }) {
//   const context = buildDestinationContext();

//   const response = await client.messages.create({
//     model: MODEL,
//     max_tokens: 1024,
//     system: `Kamu adalah search engine cerdas untuk aplikasi wisata Lombok. 
// Berikan respons HANYA dalam format JSON valid berikut, tanpa teks lain:
// {
//   "interpretation": "penjelasan singkat apa yang user cari",
//   "category": "Hotels|Destinations|Culinary|Beaches|Islands|Adventure|Culture|All",
//   "filters": {
//     "minPrice": null,
//     "maxPrice": null,
//     "minRating": null
//   },
//   "suggestions": ["nama tempat 1", "nama tempat 2"],
//   "searchQuery": "kata kunci untuk filter database"
// }`,
//     messages: [{
//       role: 'user',
//       content: `Query user: "${query}"\n\nData tersedia:\n${context}\n\nParse query ini menjadi filter pencarian.`,
//     }],
//   });

//   const raw = response.content[0].text.replace(/```json|```/g, '').trim();
//   return JSON.parse(raw);
// }

// // ─── 3. AUTO-GENERATE DESKRIPSI ──────────────────────────────────────────────
// async function generateDescription({ type, name, location, amenities, price, rating }) {
//   const typeLabel = type === 'hotel' ? 'hotel' : type === 'destination' ? 'destinasi wisata' : 'restoran';

//   const response = await client.messages.create({
//     model: MODEL,
//     max_tokens: 512,
//     system: `Kamu adalah copywriter profesional untuk platform wisata Lombok. 
// Tulis deskripsi yang menarik, informatif, dan membuat wisatawan tertarik mengunjungi tempat tersebut.
// Gunakan bahasa Indonesia yang natural dan memikat. Panjang 2-3 paragraf.
// JANGAN gunakan kalimat generik. Fokus pada keunikan dan daya tarik spesifik tempat tersebut.`,
//     messages: [{
//       role: 'user',
//       content: `Buat deskripsi untuk ${typeLabel} berikut:
// Nama: ${name}
// Lokasi: ${location}
// ${amenities?.length ? `Fasilitas: ${amenities.join(', ')}` : ''}
// ${price ? `Harga: $${price}` : ''}
// ${rating ? `Rating: ${rating}/5` : ''}

// Tulis deskripsi yang memukau!`,
//     }],
//   });

//   return response.content[0].text;
// }

// // ─── 4. TRIP PLANNER ─────────────────────────────────────────────────────────
// async function generateTripPlan({ duration, budget, interests, startDate, groupType }) {
//   const context = buildDestinationContext();

//   const response = await client.messages.create({
//     model: MODEL,
//     max_tokens: 2048,
//     system: `Kamu adalah trip planner expert untuk Lombok, Indonesia.
// Buat itinerary HANYA dalam format JSON valid berikut, tanpa teks lain:
// {
//   "title": "judul perjalanan",
//   "summary": "ringkasan singkat perjalanan",
//   "totalEstimatedCost": 0,
//   "days": [
//     {
//       "day": 1,
//       "date": "tanggal",
//       "title": "tema hari ini",
//       "activities": [
//         {
//           "time": "08:00",
//           "name": "nama tempat/aktivitas",
//           "type": "hotel|destination|restaurant|transport",
//           "location": "lokasi",
//           "duration": "2 jam",
//           "estimatedCost": 0,
//           "notes": "tips atau catatan",
//           "itemId": "id dari database jika ada, null jika tidak"
//         }
//       ],
//       "dailyCost": 0
//     }
//   ],
//   "tips": ["tip 1", "tip 2", "tip 3"],
//   "bestTimeToVisit": "penjelasan waktu terbaik"
// }`,
//     messages: [{
//       role: 'user',
//       content: `Buat itinerary Lombok untuk:
// - Durasi: ${duration} hari
// - Budget: $${budget} per orang
// - Minat: ${interests.join(', ')}
// - Tanggal mulai: ${startDate || 'fleksibel'}
// - Tipe grup: ${groupType || 'couple'}

// Data hotel, destinasi, dan restoran yang tersedia:
// ${context}

// Prioritaskan tempat dari data di atas. Buat itinerary yang realistis dan detail.`,
//     }],
//   });

//   const raw = response.content[0].text.replace(/```json|```/g, '').trim();
//   return JSON.parse(raw);
// }

// module.exports = { chatWithAssistant, smartSearch, generateDescription, generateTripPlan };


// src/services/aiService.js — versi Ollama lokal
const db = require('../config/database');

const OLLAMA_URL  = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL    || 'qwen2.5:7b';

async function ollamaChat(systemPrompt, userMessage, jsonMode = false) {
  const body = {
    model: OLLAMA_MODEL,
    stream: false,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage   },
    ],
    ...(jsonMode && { format: 'json' }),
    options: { temperature: 0.7, num_ctx: 4096 },
  };

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Ollama error: ${res.statusText}`);
  const data = await res.json();
  return data.message.content;
}