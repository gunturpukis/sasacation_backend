// src/services/preferenceExtractorService.js
// Ini yang membuat Travel Memory terasa "otomatis" — user tidak perlu isi
// form preferensi manual, cukup ngobrol biasa dengan Sasa, dan sistem
// menyimpulkan sinyal preferensi dari situ.
//
// PENTING soal keandalan: ini LLM extraction, bukan parsing deterministik.
// Karena itu:
//   1. Dipanggil fire-and-forget (tidak pernah memperlambat/menggagalkan
//      response chat utama ke user — lihat pemanggilannya di aiController.js)
//   2. Extraction bersifat ADDITIVE, tidak pernah menghapus data yang sudah
//      ada tanpa alasan (union interests, bukan overwrite)
//   3. Setiap hasil ekstraksi disimpan mentah ke raw_signals (audit trail) —
//      supaya kalau suatu saat AI salah menyimpulkan sesuatu, ada jejak untuk
//      di-debug dan preferensi bisa dikoreksi manual lewat halaman Profile

const pool = require('../config/db');
const { extractJsonObject } = require('./jsonExtractor');

const OLLAMA_URL   = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL    || 'llama3.1:latest';

const EXTRACTION_SYSTEM_PROMPT = `Kamu adalah sistem ekstraksi data, BUKAN chatbot. Tugasmu: baca potongan percakapan antara user dan AI travel assistant, lalu simpulkan sinyal preferensi TRAVEL yang EKSPLISIT disebutkan user.

ATURAN KETAT:
- HANYA ambil apa yang benar-benar disebutkan/tersirat kuat dari user. JANGAN mengarang atau menebak berlebihan.
- Kalau tidak ada sinyal baru sama sekali di percakapan ini, kembalikan semua array kosong dan budget null.
- interests/dislikes: kata benda singkat (2-3 kata), bukan kalimat. Contoh benar: "private pool", "hiking". Contoh salah: "suka berenang di pantai yang sepi".
- Balas HANYA objek JSON dengan skema persis ini, tanpa teks tambahan:
{
  "budgetMin": number | null,
  "budgetMax": number | null,
  "preferredGroupType": "solo" | "couple" | "family" | "friends" | null,
  "minStarRating": number | null,
  "newInterests": string[],
  "newDislikes": string[]
}`;

async function extractSignals(recentMessages) {
  const transcript = recentMessages
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: transcript },
      ],
      // num_predict kecil sengaja — output skema di atas selalu pendek,
      // dan ini mengurangi risiko hang yang sama seperti kasus trip plan
      options: { temperature: 0.2, num_ctx: 2048, num_predict: 300 },
    }),
  });

  if (!res.ok) throw new Error(`Ollama extraction error: ${res.status}`);
  const data = await res.json();
  return extractJsonObject(data.message.content);
}

async function mergeIntoPreferences(userId, signals) {
  const { budgetMin, budgetMax, preferredGroupType, minStarRating, newInterests = [], newDislikes = [] } = signals;

  // Union array supaya tidak menghapus interest lama yang tidak disebut lagi
  // di percakapan ini — preferensi bersifat akumulatif, bukan snapshot per-chat.
  await pool.query(
    `INSERT INTO user_preferences (user_id, budget_min, budget_max, preferred_group_type, min_star_rating, interests, dislikes, raw_signals, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       budget_min = COALESCE(EXCLUDED.budget_min, user_preferences.budget_min),
       budget_max = COALESCE(EXCLUDED.budget_max, user_preferences.budget_max),
       preferred_group_type = COALESCE(EXCLUDED.preferred_group_type, user_preferences.preferred_group_type),
       min_star_rating = COALESCE(EXCLUDED.min_star_rating, user_preferences.min_star_rating),
       interests = (SELECT ARRAY(SELECT DISTINCT unnest(user_preferences.interests || EXCLUDED.interests))),
       dislikes = (SELECT ARRAY(SELECT DISTINCT unnest(user_preferences.dislikes || EXCLUDED.dislikes))),
       raw_signals = user_preferences.raw_signals || EXCLUDED.raw_signals,
       updated_at = NOW()`,
    [
      userId, budgetMin, budgetMax, preferredGroupType, minStarRating,
      newInterests, newDislikes,
      JSON.stringify([{ at: new Date().toISOString(), signals }]),
    ]
  );
}

// Entry point dipanggil dari aiController.js — fire-and-forget, jadi
// caller-nya TIDAK await ini di jalur response utama.
async function extractAndMergePreferences(userId, recentMessages) {
  try {
    const signals = await extractSignals(recentMessages);
    const hasSignal =
      signals.budgetMin || signals.budgetMax || signals.preferredGroupType ||
      signals.minStarRating || signals.newInterests?.length || signals.newDislikes?.length;

    if (!hasSignal) return; // tidak ada yang baru, tidak perlu tulis apa-apa

    await mergeIntoPreferences(userId, signals);
    console.log(`[PreferenceExtractor] Preferensi user ${userId} diperbarui:`, signals);
  } catch (e) {
    // Sengaja hanya log, TIDAK throw — ini proses background, kegagalannya
    // tidak boleh terlihat oleh user maupun mengganggu fitur chat utama.
    console.error('[PreferenceExtractor] Gagal ekstraksi (diabaikan):', e.message);
  }
}

module.exports = { extractAndMergePreferences };
