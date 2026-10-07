// src/services/agentOrchestratorService.js
// Ini "otak" dari Agent-Based Workflow — dari konsep Anda:
//   Hotel Agent → Restaurant Agent → Budget Agent → (Weather/Transport: lihat catatan) → Booking Agent
//
// CATATAN JUJUR soal cakupan: saya HANYA mengimplementasikan agent yang
// datanya benar-benar ada di database Sasacation (hotel, restoran, destinasi/
// aktivitas, budget). Weather Agent, Flight/Transport Agent, dan Booking
// Agent otomatis TIDAK dibuat di sini karena backend belum punya sumber data
// untuk itu (tidak ada integrasi cuaca/tiket pesawat, dan booking tetap harus
// lewat konfirmasi eksplisit user, bukan otomatis) — kalau agent itu dibuat
// sekarang, isinya akan LLM mengarang data, bukan agent yang benar-benar
// bekerja dengan data nyata.

const { selectHotels } = require('./agents/hotelAgent');
const { selectRestaurants } = require('./agents/restaurantAgent');
const { selectActivities } = require('./agents/activityAgent');
const { estimateBudget } = require('./agents/budgetAgent');
const { composeItinerary } = require('./agents/itineraryComposerAgent');
const { getUserContext } = require('./userContextService');

/**
 * @param {object} params
 * @param {number} params.duration
 * @param {number} params.budget
 * @param {string[]} params.interests
 * @param {string} [params.startDate]
 * @param {string} [params.groupType]
 * @param {string} [params.userId]
 * @returns {Promise<object>} TripPlan JSON (skema sama dengan generateTripPlan lama)
 *   + field `agentTrace` untuk observability (berapa kandidat tiap agent temukan —
 *   app boleh abaikan field ini, tidak ada di TripPlan.fromJson milik app)
 */
async function runTripPlanningAgents({ duration, budget, interests, startDate, groupType, userId }) {
  const userContext = await getUserContext(userId);
  // F.5: normalisasi tanggal mulai → konkret (tolak tahun basi seperti 2023
  // yang pernah lolos dari LLM). Tanggal per-hari di-stamp deterministik
  // setelah composer (LLM tidak dipercaya untuk aritmetika tanggal).
  const resolvedStart = resolveStartDate(startDate);
  const dislikes = extractDislikesFromContext(userContext);
  const userContextBlock = userContext
    ? `\n\nKONTEKS TAMBAHAN TENTANG USER:\n${userContext}`
    : '';

  console.log('[AgentOrchestrator] Menjalankan Hotel/Restaurant/Activity Agent secara paralel...');
  const [hotelCandidates, restaurantCandidates, activityCandidates] = await Promise.all([
    selectHotels({ budget, groupType, dislikes }),
    selectRestaurants({ interests, dislikes }),
    selectActivities({ interests, dislikes }),
  ]);
  console.log(`[AgentOrchestrator] Hotel: ${hotelCandidates.length}, Restoran: ${restaurantCandidates.length}, Aktivitas: ${activityCandidates.length}`);

  console.log('[AgentOrchestrator] Menjalankan Budget Agent...');
  const budgetEstimate = estimateBudget({ hotelCandidates, restaurantCandidates, duration, groupType });

  console.log('[AgentOrchestrator] Menjalankan Itinerary Composer Agent...');
  const plan = await composeItinerary({
    duration, budget, interests, startDate: resolvedStart, groupType,
    hotelCandidates, restaurantCandidates, activityCandidates,
    budgetEstimate, userContextBlock,
  });

  // F.5: stamp tanggal deterministik + validasi budget.
  stampPlanDates(plan, resolvedStart);
  validatePlanBudget(plan);

  return {
    ...plan,
    agentTrace: {
      hotelCandidateCount: hotelCandidates.length,
      restaurantCandidateCount: restaurantCandidates.length,
      activityCandidateCount: activityCandidates.length,
      budgetEstimate,
    },
  };
}

// ─── F.5: normalisasi & validasi tanggal/budget (deterministik) ────────────
// LLM lokal terbukti tidak bisa dipercaya untuk tanggal ("2023", tema
// meleset — temuan audit). Jadi: startDate selalu diresolve ke tanggal
// konkret di sini, dan field `date` per-hari di-stamp ulang setelah composer.
function resolveStartDate(startDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (typeof startDate === 'string' && startDate.trim()) {
    const parsed = new Date(startDate.trim());
    if (!Number.isNaN(parsed.getTime())) {
      parsed.setHours(0, 0, 0, 0);
      // Tolak tanggal basi (>1 hari ke belakang): fallback ke hari ini.
      // Ini yang mencegah kasus "tanggal 2023" lolos ke user.
      if (parsed.getTime() >= today.getTime() - 24 * 3600 * 1000) {
        return parsed.toISOString().slice(0, 10);
      }
    }
  }
  return today.toISOString().slice(0, 10);
}

function stampPlanDates(plan, resolvedStart) {
  if (!plan || !Array.isArray(plan.days)) return;
  const base = new Date(resolvedStart + 'T00:00:00Z').getTime();
  plan.days.forEach((d, i) => {
    d.date = new Date(base + i * 24 * 3600 * 1000).toISOString().slice(0, 10);
  });
}

// Kalau totalEstimatedCost LLM meleset >20% dari jumlah dailyCost,
// percayai penjumlahan (angka grounded) — catat di log untuk eval.
function validatePlanBudget(plan) {
  if (!plan || !Array.isArray(plan.days)) return;
  const sum = plan.days.reduce((s, d) => s + (Number(d.dailyCost) || 0), 0);
  const total = Number(plan.totalEstimatedCost) || 0;
  if (sum > 0 && (total === 0 || Math.abs(total - sum) / sum > 0.2)) {
    console.log(`[AgentOrchestrator] totalEstimatedCost dikoreksi ${total} → ${sum} (validasi F.5)`);
    plan.totalEstimatedCost = Math.round(sum * 100) / 100;
  }
}

// Ambil daftar dislikes dari blok teks userContext (format sudah pasti dari
// userContextService.js: baris "Tidak suka: a, b, c"). Sengaja parsing teks
// alih-alih query ulang ke DB, supaya satu sumber kebenaran (userContextService)
// tidak dobel diimplementasikan di tempat lain.
function extractDislikesFromContext(userContext) {
  if (!userContext) return [];
  const line = userContext.split('\n').find(l => l.startsWith('Tidak suka'));
  if (!line) return [];
  return line.replace('Tidak suka:', '').split(',').map(s => s.trim()).filter(Boolean);
}

module.exports = { runTripPlanningAgents, resolveStartDate, stampPlanDates, validatePlanBudget };
