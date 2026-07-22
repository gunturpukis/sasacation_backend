// src/services/agents/itineraryComposerAgent.js
// Beda penting dari generateTripPlan versi lama: prompt lama menyodorkan
// SEMUA dokumen RAG mentah ke LLM lalu minta LLM pilih & susun sekaligus.
// Sekarang, pemilihan kandidat sudah selesai di hotelAgent/restaurantAgent/
// activityAgent — LLM di sini HANYA menyusun jadwal dari kandidat yang sudah
// difilter, bukan memilih dari kolam data mentah. Ini mengurangi kemungkinan
// LLM "memilih" tempat yang sebetulnya kurang relevan hanya karena dekat di
// urutan prompt.

const { extractJsonObject } = require('../jsonExtractor');

const OLLAMA_URL   = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL    || 'llama3.1:latest';

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
      options: { temperature: 0.7, num_ctx: 4096, num_predict: 1500 },
    }),
  });
  if (!res.ok) throw new Error(`Ollama error (${res.status}): ${res.statusText}`);
  const data = await res.json();
  return data.message.content;
}

function candidatesToText(label, candidates) {
  if (!candidates.length) return `${label}: tidak ada kandidat ditemukan.`;
  return `${label}:\n` + candidates
    .map(c => `- [id: ${c.id}] ${c.name} — ${c.location} — $${c.price} — rating ${c.rating}/5`)
    .join('\n');
}

/**
 * @param {object} params
 * @param {number} params.duration
 * @param {number} params.budget
 * @param {string[]} params.interests
 * @param {string} [params.startDate]
 * @param {string} [params.groupType]
 * @param {Array} params.hotelCandidates
 * @param {Array} params.restaurantCandidates
 * @param {Array} params.activityCandidates
 * @param {object} params.budgetEstimate - hasil budgetAgent.estimateBudget
 * @param {string} [params.userContextBlock]
 * @returns {Promise<object>} TripPlan JSON — SKEMA SAMA PERSIS dengan generateTripPlan lama,
 *   supaya app tidak perlu berubah sama sekali untuk mengonsumsi ini.
 */
async function composeItinerary({
  duration, budget, interests, startDate, groupType,
  hotelCandidates, restaurantCandidates, activityCandidates,
  budgetEstimate, userContextBlock = '',
}) {
  const systemPrompt = `Kamu adalah trip planner expert untuk Lombok, Indonesia.
Tugasmu HANYA menyusun jadwal dari KANDIDAT yang sudah diberikan di bawah — JANGAN menambahkan tempat yang tidak ada di daftar kandidat.
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
          "name": "nama tempat/aktivitas — HARUS dari daftar kandidat",
          "type": "hotel|destination|restaurant|transport",
          "location": "lokasi",
          "duration": "2 jam",
          "estimatedCost": 0,
          "notes": "tips atau catatan",
          "itemId": "id dari kandidat, null jika transport/aktivitas umum"
        }
      ],
      "dailyCost": 0
    }
  ],
  "tips": ["tip 1", "tip 2", "tip 3"],
  "bestTimeToVisit": "penjelasan waktu terbaik"
}`;

  const userMessage = `Susun itinerary Lombok untuk:
- Durasi: ${duration} hari
- Budget: $${budget} per orang
- Minat: ${interests.join(', ')}
- Tanggal mulai: ${startDate || 'fleksibel'}
- Tipe grup: ${groupType || 'couple'}

KANDIDAT YANG SUDAH DIKURASI (pilih dari sini saja, jangan mengarang tempat baru):

${candidatesToText('HOTEL', hotelCandidates)}

${candidatesToText('RESTORAN', restaurantCandidates)}

${candidatesToText('AKTIVITAS/DESTINASI', activityCandidates)}

ESTIMASI BUDGET ACUAN (hasil perhitungan sistem, jadikan panduan totalEstimatedCost — usahakan angkamu tidak jauh berbeda):
- Akomodasi: $${budgetEstimate.estimatedAccommodation}
- Makan: $${budgetEstimate.estimatedFood}
- Aktivitas: $${budgetEstimate.estimatedActivities}
- Total acuan: $${budgetEstimate.totalEstimated}${userContextBlock}

Balas HANYA dengan objek JSON, tanpa teks tambahan.`;

  const raw = await ollamaChat(systemPrompt, userMessage);
  return extractJsonObject(raw);
}

module.exports = { composeItinerary };
