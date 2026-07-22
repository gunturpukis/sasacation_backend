// src/services/agents/restaurantAgent.js
const { retrieveRelevantDocs } = require('../ragService');

function filterDislikes(docs, dislikes = []) {
  if (!dislikes.length) return docs;
  const lowerDislikes = dislikes.map(d => d.toLowerCase());
  return docs.filter(d => !lowerDislikes.some(dl => d.content.toLowerCase().includes(dl)));
}

/**
 * @param {object} params
 * @param {string[]} params.interests
 * @param {string[]} [params.dislikes]
 * @param {number} [params.topK]
 * @returns {Promise<Array>} kandidat restoran { id, name, location, price, rating, image, content }
 */
async function selectRestaurants({ interests = [], dislikes = [], topK = 3 }) {
  const query = `restoran kuliner ${interests.join(' ')} Lombok`.trim();
  const docs = await retrieveRelevantDocs(query, { topK: topK + dislikes.length + 2, docType: 'restaurant' });
  const filtered = filterDislikes(docs, dislikes).slice(0, topK);

  return filtered.map(d => ({ ...d.metadata, content: d.content, similarity: d.similarity }));
}

module.exports = { selectRestaurants };
