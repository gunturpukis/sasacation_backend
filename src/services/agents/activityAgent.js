// src/services/agents/activityAgent.js
// Diambil dari logika retrieve-per-interest yang sebelumnya inline di
// generateTripPlan (aiService.js) — sekarang jadi agent sendiri dengan
// tanggung jawab jelas: "cari aktivitas/destinasi", titik.

const { retrieveRelevantDocs } = require('../ragService');

function filterDislikes(docs, dislikes = []) {
  if (!dislikes.length) return docs;
  const lowerDislikes = dislikes.map(d => d.toLowerCase());
  return docs.filter(d => !lowerDislikes.some(dl => d.content.toLowerCase().includes(dl)));
}

/**
 * Retrieve per-interest secara terpisah (bukan satu query gabungan) supaya
 * semua kategori yang diminta user terwakili, tidak bias ke satu kategori
 * yang paling dominan secara semantik.
 *
 * @param {object} params
 * @param {string[]} params.interests
 * @param {string[]} [params.dislikes]
 * @param {number} [params.perInterestTopK]
 * @returns {Promise<Array>} kandidat destinasi { id, name, location, price, rating, image, content }
 */
async function selectActivities({ interests = [], dislikes = [], perInterestTopK = 4 }) {
  const allDocs = [];
  const seenIds = new Set();

  for (const interest of interests) {
    const docs = await retrieveRelevantDocs(`wisata ${interest} Lombok`, {
      topK: perInterestTopK,
      docType: 'destination',
    });
    for (const doc of docs) {
      if (!seenIds.has(doc.doc_id)) {
        seenIds.add(doc.doc_id);
        allDocs.push(doc);
      }
    }
  }

  return filterDislikes(allDocs, dislikes).map(d => ({
    ...d.metadata,
    content: d.content,
    similarity: d.similarity,
  }));
}

module.exports = { selectActivities };
