// src/services/ragService.js
// Inti dari RAG: embed query user, cari dokumen paling mirip di pgvector,
// lalu kembalikan sebagai context yang siap dipakai LLM.

const pool = require('../config/db');

const OLLAMA_URL         = process.env.OLLAMA_BASE_URL   || 'http://localhost:11434';
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
const RAG_TOP_K          = Number(process.env.RAG_TOP_K) || 5;
const RAG_THRESHOLD      = Number(process.env.RAG_SIMILARITY_THRESHOLD) || 0.3;

// ─── Embed teks query menjadi vektor ─────────────────────────────────────────
async function embedQuery(text) {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, prompt: text }),
  });
  if (!res.ok) throw new Error(`Ollama embed error: ${await res.text()}`);
  const data = await res.json();
  return data.embedding;
}

/**
 * Cari dokumen paling relevan dengan query menggunakan cosine similarity.
 *
 * pgvector operator `<=>` menghitung cosine DISTANCE (0 = identik, 2 = berlawanan).
 * Similarity = 1 - distance, jadi similarity mendekati 1 = sangat mirip.
 *
 * @param {string} query - teks pencarian dari user
 * @param {object} opts
 * @param {number} opts.topK - jumlah dokumen teratas yang diambil
 * @param {string} opts.docType - filter tipe dokumen: 'hotel' | 'destination' | 'restaurant' | null (semua)
 * @returns {Promise<Array>} dokumen dengan skor similarity, diurutkan dari paling relevan
 */
async function retrieveRelevantDocs(query, { topK = RAG_TOP_K, docType = null } = {}) {
  const queryVector = await embedQuery(query);
  const vectorStr = `[${queryVector.join(',')}]`;

  const params = [vectorStr, topK];
  let typeFilter = '';
  if (docType) {
    typeFilter = 'WHERE doc_type = $3';
    params.push(docType);
  }

  const { rows } = await pool.query(`
    SELECT
      doc_id,
      doc_type,
      content,
      metadata,
      1 - (embedding <=> $1::vector) AS similarity
    FROM document_embeddings
    ${typeFilter}
    ORDER BY embedding <=> $1::vector
    LIMIT $2
  `, params);

  // Filter dokumen yang similarity-nya terlalu rendah (tidak relevan)
  return rows.filter(r => r.similarity >= RAG_THRESHOLD);
}

/**
 * Bangun context string dari dokumen yang di-retrieve, siap disisipkan ke prompt LLM.
 */
function buildContextFromDocs(docs) {
  if (docs.length === 0) {
    return 'Tidak ada data yang relevan ditemukan di database Sasacation.';
  }
  return docs
    .map((d, i) => `[Dokumen ${i + 1} — similarity ${(d.similarity * 100).toFixed(0)}%]\n${d.content}`)
    .join('\n\n');
}

/**
 * Fungsi utama RAG: query → retrieve → build context.
 * Dipakai oleh semua fitur AI (chat, search, trip plan, description).
 */
async function ragRetrieve(query, opts = {}) {
  const docs = await retrieveRelevantDocs(query, opts);
  const context = buildContextFromDocs(docs);
  return { docs, context };
}

module.exports = { embedQuery, retrieveRelevantDocs, buildContextFromDocs, ragRetrieve };
