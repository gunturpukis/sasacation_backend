// src/services/intentDetectorService.js
// Ini yang menjawab poin konsep Anda: "User berkata 'Saya mau honeymoon 4
// hari di Lombok' → AI seharusnya otomatis menjalankan rangkaian aksi",
// BUKAN user harus pindah ke menu Trip Planner dulu.
//
// Dipanggil di aiController.js SEBELUM chatWithAssistant biasa. Kalau intent
// terdeteksi DAN field minimum (duration, budget) sudah disebut user →
// controller akan memanggil agentOrchestratorService langsung. Kalau field
// belum lengkap, TIDAK memaksa — dibiarkan lanjut ke chatWithAssistant biasa,
// karena Sasa (sebagai asisten percakapan umum) sudah cukup wajar untuk
// menanyakan detail yang belum jelas secara natural.
 
const { extractJsonObject } = require('./jsonExtractor');
 
const OLLAMA_URL   = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL    || 'llama3.1:latest';
 
const SYSTEM_PROMPT = `Kamu adalah sistem klasifikasi intent, BUKAN chatbot. Baca SATU pesan user dan tentukan apakah ini permintaan MEMBUAT RENCANA PERJALANAN (trip planning) — bukan sekadar tanya-tanya info.
 
Contoh YANG TERMASUK trip planning intent:
- "Saya mau honeymoon 4 hari di Lombok"
- "Buatkan itinerary 3 hari budget 500 dollar"
- "Rencanain trip keluarga 5 hari dong"
 
Contoh YANG BUKAN:
- "Hotel apa yang bagus di Senggigi?" (tanya info, bukan minta rencana lengkap)
- "Berapa harga tiket Gili Trawangan?" (tanya info)
- "Halo" / "Terima kasih" (bukan permintaan apa pun)
 
ATURAN:
- Ekstrak HANYA field yang benar-benar disebutkan/tersirat jelas di pesan. JANGAN menebak angka yang tidak disebut.
- duration dalam jumlah hari (angka). budget dalam USD (angka). Kalau tidak disebutkan, null.
- Balas HANYA objek JSON dengan skema persis ini, tanpa teks tambahan:
{
  "isTripPlanningIntent": boolean,
  "duration": number | null,
  "budget": number | null,
  "interests": string[],
  "groupType": "solo" | "couple" | "family" | "friends" | null,
  "startDate": string | null
}`;
 
// Penyaring MURAH sebelum panggil LLM. Tanpa ini, SETIAP pesan chat (termasuk
// "halo" atau "makasih") akan memicu 1 pemanggilan Ollama tambahan untuk
// deteksi intent — di Ollama lokal yang sudah lumayan lambat (lihat catatan
// timing di aiService.js/ollamaChat), ini bisa menggandakan waktu tunggu user
// untuk SEMUA pesan, bukan cuma yang relevan. Heuristic ini sengaja permisif
// (banyak false positive lebih baik daripada melewatkan niat asli) karena
// yang mahal itu LLM call, bukan regex.
const TRIP_PLANNING_KEYWORDS = [
  'rencana', 'itinerary', 'trip', 'liburan', 'honeymoon', 'bulan madu',
  'jalan-jalan', 'jalan jalan', 'vacation', 'plan', 'susun', 'rancang',
  'wisata ke', 'ke lombok', 'ke gili',
];
 
function looksLikeTripPlanningMessage(text) {
  const lower = text.toLowerCase();
  const hasKeyword = TRIP_PLANNING_KEYWORDS.some(k => lower.includes(k));
  const hasDayNumber = /\d+\s*(hari|day|days)/.test(lower);
  return hasKeyword || hasDayNumber;
}
 
async function extractTripIntent(message) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: message },
      ],
      options: { temperature: 0.1, num_ctx: 2048, num_predict: 250 },
    }),
  });
  if (!res.ok) throw new Error(`Ollama intent detection error: ${res.status}`);
  const data = await res.json();
  return extractJsonObject(data.message.content);
}
 
// ─── Jalan pintas regex, SEBELUM panggil LLM ────────────────────────────────
// Latar belakang: Agent Workflow yang dipicu dari chat ternyata butuh 2
// pemanggilan Ollama besar berurutan (intent detection lalu itinerary
// composer) di atas timeout 90 detik app — di Ollama lokal ini gampang
// timeout (lihat log Dio "took longer than 0:01:30"). Kalau pesan user
// SUDAH eksplisit sebut angka hari & budget, kita tidak butuh LLM untuk
// "menyimpulkan" itu — regex sudah cukup pasti, dan ini menghilangkan
// SATU pemanggilan Ollama penuh dari jalur kritis.
//
// Kalau regex tidak yakin (salah satu field tidak ketemu), function ini
// return null dan caller HARUS fallback ke extractTripIntent (LLM) —
// regex tidak pernah memaksakan tebakan.
const GROUP_TYPE_KEYWORDS = {
  family: ['keluarga', 'family', 'anak'],
  friends: ['teman', 'sahabat', 'friends', 'rombongan'],
  couple: ['honeymoon', 'bulan madu', 'pasangan', 'couple', 'berdua'],
};
 
function regexExtractTripIntent(message) {
  const lower = message.toLowerCase();
 
  const durationMatch = lower.match(/(\d+)\s*(?:hari|day|days)/);
  const budgetMatch = lower.match(/(?:\$|budget\s*\$?|usd\s*)(\d+(?:[.,]\d+)?)\s*(?:dollar|usd)?/);
 
  // Kedua field WAJIB ketemu — kalau cuma salah satu, tetap fallback ke LLM
  // supaya tidak salah asumsi (mis. angka yang ketemu regex ternyata bukan
  // budget, tapi nomor lain yang kebetulan mirip pola)
  if (!durationMatch || !budgetMatch) return null;
 
  let groupType = null;
  for (const [type, keywords] of Object.entries(GROUP_TYPE_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) { groupType = type; break; }
  }
 
  return {
    isTripPlanningIntent: true,
    duration: parseInt(durationMatch[1], 10),
    budget: parseFloat(budgetMatch[1].replace(',', '.')),
    interests: [], // tidak dicoba ditebak dari regex — biar agentOrchestratorService pakai default
    groupType,
    startDate: null,
  };
}
 
// Field minimum supaya agent workflow bisa jalan tanpa harus nebak-nebak.
// interests/groupType/startDate punya default masuk akal di agentOrchestratorService
// kalau kosong, tapi duration & budget TIDAK bisa didefault — itinerary tanpa
// durasi/budget yang jelas berisiko generate rencana yang salah asumsi.
function hasMinimumFieldsForWorkflow(intent) {
  return Boolean(intent.isTripPlanningIntent && intent.duration && intent.budget);
}
 
module.exports = {
  extractTripIntent,
  regexExtractTripIntent,
  hasMinimumFieldsForWorkflow,
  looksLikeTripPlanningMessage,
};