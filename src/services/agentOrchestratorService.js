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
    duration, budget, interests, startDate, groupType,
    hotelCandidates, restaurantCandidates, activityCandidates,
    budgetEstimate, userContextBlock,
  });

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

module.exports = { runTripPlanningAgents };
