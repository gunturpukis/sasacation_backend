// src/services/jsonExtractor.js
// Diekstrak dari logika brace-counting yang sebelumnya inline di dalam
// generateTripPlan (aiService.js). Alasan tidak pakai Ollama `format: 'json'`
// (jsonMode): sudah pernah terbukti bikin grammar-constrained decoding hang
// pada model lokal untuk output panjang (lihat catatan di generateTripPlan).
// Manual brace-counting lebih toleran dan robust untuk kasus ini, jadi
// dipakai juga oleh preferenceExtractorService.js (#2).

function extractJsonObject(raw) {
  const start = raw.indexOf('{');
  if (start === -1) throw new Error('Tidak ada objek JSON pada output AI');

  let depth = 0, end = -1;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === '{') depth++;
    if (raw[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error('Objek JSON pada output AI terpotong');

  return JSON.parse(raw.slice(start, end + 1));
}

module.exports = { extractJsonObject };
