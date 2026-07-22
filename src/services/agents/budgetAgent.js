// src/services/agents/budgetAgent.js
// SENGAJA bukan LLM call. LLM lokal (llama3.1 di Ollama) terbukti tidak
// selalu konsisten untuk aritmatika — kalau budget dihitung oleh LLM,
// totalEstimatedCost bisa tidak nyambung dengan penjumlahan dailyCost per
// hari. Untuk angka, JavaScript biasa jauh lebih bisa diandalkan.
//
// Agent ini menghasilkan ESTIMASI KASAR dari kandidat yang sudah dipilih
// hotelAgent/restaurantAgent — bukan angka final itinerary (itu tetap
// disusun itineraryComposerAgent), tapi jadi ANGKA ACUAN yang disisipkan ke
// prompt composer supaya LLM tidak mengarang angka dari nol.

const MEALS_PER_DAY = 3;
const ACTIVITY_ESTIMATE_PER_DAY = 15; // asumsi kasar biaya aktivitas/tiket per hari, dalam USD

function average(numbers) {
  const valid = numbers.filter(n => typeof n === 'number' && !isNaN(n));
  if (valid.length === 0) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/**
 * @param {object} params
 * @param {Array} params.hotelCandidates - hasil hotelAgent.selectHotels
 * @param {Array} params.restaurantCandidates - hasil restaurantAgent.selectRestaurants
 * @param {number} params.duration - jumlah hari
 * @param {string} [params.groupType]
 * @returns {object} estimasi budget breakdown
 */
function estimateBudget({ hotelCandidates = [], restaurantCandidates = [], duration, groupType }) {
  const nights = Math.max(duration - 1, 1);
  const avgHotelPrice = average(hotelCandidates.map(h => h.price));
  const avgMealPrice = average(restaurantCandidates.map(r => r.price));

  const groupMultiplier = groupType === 'family' ? 1.5 : groupType === 'friends' ? 1.2 : 1;

  const estimatedAccommodation = Math.round(avgHotelPrice * nights);
  const estimatedFood = Math.round(avgMealPrice * MEALS_PER_DAY * duration * groupMultiplier);
  const estimatedActivities = Math.round(ACTIVITY_ESTIMATE_PER_DAY * duration);
  const totalEstimated = estimatedAccommodation + estimatedFood + estimatedActivities;

  return {
    estimatedAccommodation,
    estimatedFood,
    estimatedActivities,
    totalEstimated,
    perDayEstimate: Math.round(totalEstimated / duration),
    // Disertakan supaya composer/observability tahu ini dihitung dari berapa
    // kandidat — kalau avgHotelPrice = 0 (tidak ada kandidat hotel), berarti
    // estimasi ini tidak bisa dipercaya, composer harus tahu itu.
    basis: {
      hotelCandidateCount: hotelCandidates.length,
      restaurantCandidateCount: restaurantCandidates.length,
      avgHotelPricePerNight: Math.round(avgHotelPrice),
      avgMealPrice: Math.round(avgMealPrice),
    },
  };
}

module.exports = { estimateBudget };
