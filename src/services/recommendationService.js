// src/services/recommendationService.js
// Ini yang menutup lingkaran "Belum ada Recommendation Engine" dari konsep
// Anda. Bedanya dengan RAG biasa (ragService.js): RAG biasa query-nya adalah
// TEKS YANG DIKETIK user ("hotel dekat pantai"). Di sini, query-nya adalah
// RINGKASAN PROFIL user (wishlist + riwayat booking + preferences) yang
// di-embed lalu dicocokkan ke katalog hotel yang sudah ada di pgvector —
// jadi "cari hotel yang mirip dengan pola perilaku user", bukan "cari hotel
// yang cocok dengan kalimat yang diketik user".
//
// Infrastruktur pgvector-nya TIDAK perlu diubah sama sekali — document_embeddings
// sudah berisi embedding hotel dari ragIndexer.js yang sudah ada. Yang baru
// hanya CARA MENYUSUN QUERY-nya.

const pool = require('../config/db');
const { retrieveRelevantDocs } = require('./ragService');
const { getUserContext } = require('./userContextService');

const DEFAULT_TOP_K = 6;

// Susun teks profil dari data yang sama yang dipakai userContextService untuk
// chat (#1/#2) — supaya "apa yang AI tahu tentang user saat chat" dan "dasar
// rekomendasi" konsisten satu sumber, tidak dua logika terpisah yang bisa beda.
async function buildProfileQueryText(userId) {
  const context = await getUserContext(userId);
  if (!context) return null;

  // dislikes butuh perlakuan khusus: kalau langsung dimasukkan apa adanya ke
  // query similarity, "tidak suka hiking" bisa malah menaikkan skor dokumen
  // yang isinya "hiking" (similarity itu soal kedekatan topik, bukan sentimen).
  // Makanya baris "Tidak suka: ..." dibuang dari teks yang di-embed —
  // exclusion utk dislikes ditangani di layer AI (system prompt), BUKAN di
  // sini, di similarity search kita hanya pakai sinyal POSITIF.
  return context
    .split('\n')
    .filter(line => !line.startsWith('Tidak suka'))
    .join('\n');
}

// Hotel yang sudah di-wishlist / pernah dibooking user — dikeluarkan dari
// rekomendasi. Merekomendasikan sesuatu yang sudah user punya itu buang-buang
// "slot perhatian" pengguna dan terasa seperti AI tidak benar-benar dengar.
async function getExcludedHotelIds(userId) {
  const { rows } = await pool.query(
    `SELECT hotel_id AS id FROM wishlist WHERE user_id = $1
     UNION
     SELECT hotel_id AS id FROM bookings WHERE user_id = $1`,
    [userId]
  );
  return rows.map(r => r.id);
}

// Fallback untuk user baru / belum ada sinyal apa pun (wishlist, booking,
// preferences kosong semua). Tanpa ini, user baru akan dapat "Recommended
// for you" kosong di hari pertama pakai app — pengalaman yang buruk.
async function getTrendingHotels(excludeIds = [], topK = DEFAULT_TOP_K) {
  const { rows } = await pool.query(
    `SELECT * FROM hotels
     WHERE id != ALL($1::uuid[])
     ORDER BY featured DESC, rating DESC NULLS LAST
     LIMIT $2`,
    [excludeIds, topK]
  );
  return rows.map(h => ({ ...h, recommendationReason: 'trending' }));
}

async function getPersonalizedRecommendations(userId, topK = DEFAULT_TOP_K) {
  const [profileText, excludedIds] = await Promise.all([
    buildProfileQueryText(userId),
    getExcludedHotelIds(userId),
  ]);

  if (!profileText) {
    // User belum punya sinyal apa pun → trending, bukan array kosong
    return getTrendingHotels(excludedIds, topK);
  }

  // Ambil lebih banyak dari topK karena sebagian akan kefilter oleh excludedIds
  const docs = await retrieveRelevantDocs(profileText, {
    topK: topK + excludedIds.length + 5,
    docType: 'hotel',
  });

  const candidateIds = docs
    .map(d => d.doc_id)
    .filter(id => !excludedIds.includes(id))
    .slice(0, topK);

  if (candidateIds.length === 0) {
    // Semua kandidat relevan ternyata sudah di-wishlist/dibooking user —
    // jarang terjadi, tapi tetap kasih fallback daripada array kosong
    return getTrendingHotels(excludedIds, topK);
  }

  const { rows } = await pool.query(
    'SELECT * FROM hotels WHERE id = ANY($1::uuid[])',
    [candidateIds]
  );

  // pgvector query sudah urut by similarity, tapi SELECT ... WHERE id = ANY()
  // tidak menjaga urutan itu — urutkan ulang manual sesuai urutan candidateIds
  const byId = Object.fromEntries(rows.map(h => [h.id, h]));
  return candidateIds
    .filter(id => byId[id])
    .map(id => ({ ...byId[id], recommendationReason: 'personalized' }));
}

module.exports = { getPersonalizedRecommendations, getTrendingHotels };
