// src/services/agents/hotelAgent.js
// Tanggung jawab SEMPIT (sesuai prinsip agent dari konsep Anda): agent ini
// HANYA memilih kandidat hotel. Tidak menyusun itinerary, tidak menghitung
// budget total — itu tugas agent lain. Ini memudahkan debug: kalau hotel
// yang direkomendasikan aneh, cek di sini saja, bukan di prompt raksasa.

const { retrieveRelevantDocs } = require('../ragService');

// Filter kandidat yang kontennya menyinggung salah satu dislikes user.
// Best-effort string matching, bukan NLU sempurna — tapi cukup untuk kasus
// jelas seperti dislikes: ["hiking"] menyaring hotel yang deskripsinya
// menonjolkan trekking/hiking sebagai daya tarik utama.
function filterDislikes(docs, dislikes = []) {
  if (!dislikes.length) return docs;
  const lowerDislikes = dislikes.map(d => d.toLowerCase());
  return docs.filter(d => {
    const content = d.content.toLowerCase();
    return !lowerDislikes.some(dislike => content.includes(dislike));
  });
}

/**
 * @param {object} params
 * @param {number} params.budget - budget per orang (dipakai sebagai sinyal, bukan hard filter —
 *   hotel murah tapi sangat relevan tetap boleh masuk, biar tidak terlalu kaku)
 * @param {string} [params.groupType]
 * @param {string[]} [params.dislikes]
 * @param {number} [params.topK]
 * @returns {Promise<Array>} kandidat hotel { id, name, location, price, rating, image, content }
 */
async function selectHotels({ budget, groupType, dislikes = [], topK = 3 }) {
  const query = `hotel penginapan budget $${budget} untuk ${groupType || 'couple'} di Lombok`;
  const docs = await retrieveRelevantDocs(query, { topK: topK + dislikes.length + 2, docType: 'hotel' });
  const filtered = filterDislikes(docs, dislikes).slice(0, topK);

  return filtered.map(d => ({ ...d.metadata, content: d.content, similarity: d.similarity }));
}

module.exports = { selectHotels };
