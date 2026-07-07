// src/services/ragIndexer.js
// Jalankan: npm run rag:index
//
// Proses:
//   1. Ambil semua hotel, destinasi, restoran dari PostgreSQL
//   2. Buat teks dokumen yang kaya informasi untuk setiap item
//   3. Kirim ke Ollama nomic-embed-text → dapat vektor 768-dim
//   4. Simpan vektor ke tabel document_embeddings (pgvector)
//
// Jalankan ulang setiap kali data berubah (tambah hotel baru, dll)

require('dotenv').config();
const pool = require('../config/db');

const OLLAMA_URL        = process.env.OLLAMA_BASE_URL  || 'http://localhost:11434';
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';

// ─── Embed satu teks → vektor float[] ───────────────────────────────────────
async function embed(text) {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, prompt: text }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama embed error: ${err}`);
  }
  const data = await res.json();
  return data.embedding; // array of 768 floats
}

// ─── Format dokumen hotel menjadi teks yang informatif ──────────────────────
function hotelToText(h) {
  return `Hotel: ${h.name}
Lokasi: ${h.location}
Alamat: ${h.address || h.location}
Harga: $${h.price} per malam
Rating: ${h.rating}/5 (${h.review_count} ulasan)
Fasilitas: ${h.amenities.join(', ')}
Deskripsi: ${h.description || ''}
Kategori: hotel penginapan Lombok`.trim();
}

// ─── Format dokumen destinasi ────────────────────────────────────────────────
function destinationToText(d) {
  return `Destinasi wisata: ${d.name}
Lokasi: ${d.location}
Kategori: ${d.sub_category || 'wisata'}
Rating: ${d.rating}/5 (${d.review_count} ulasan)
Tiket masuk: ${d.price > 0 ? `$${d.price}` : 'gratis'}
Deskripsi: ${d.description || ''}
Aktivitas: wisata alam petualangan Lombok`.trim();
}

// ─── Format dokumen restoran ─────────────────────────────────────────────────
function restaurantToText(r) {
  return `Restoran: ${r.name}
Lokasi: ${r.location}
Jenis masakan: ${r.cuisine || 'masakan lokal'}
Harga rata-rata: $${r.price} per orang
Rating: ${r.rating}/5 (${r.review_count} ulasan)
Jam buka: ${r.open_hours || 'hubungi restoran'}
Deskripsi: ${r.description || ''}
Kuliner makanan khas Lombok`.trim();
}

// ─── Main indexer ────────────────────────────────────────────────────────────
async function indexAll() {
  console.log('🔍 RAG Indexer — Sasacation\n');
  console.log(`Model embedding: ${OLLAMA_EMBED_MODEL}`);
  console.log(`Ollama URL: ${OLLAMA_URL}\n`);

  // Cek Ollama bisa diakses
  try {
    const check = await fetch(OLLAMA_URL);
    const text = await check.text();
    if (!text.includes('Ollama')) throw new Error('Unexpected response');
    console.log('✅ Ollama terhubung\n');
  } catch {
    console.error('❌ Ollama tidak bisa diakses. Pastikan Ollama berjalan.');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    // Hapus semua embedding lama sebelum indexing ulang
    await client.query('DELETE FROM document_embeddings');
    console.log('🗑️  Embedding lama dihapus\n');

    let totalIndexed = 0;

    // ── Index hotels ──────────────────────────────────────────────────────
    const { rows: hotels } = await client.query('SELECT * FROM hotels WHERE available = true');
    console.log(`📦 Indexing ${hotels.length} hotels...`);
    for (const hotel of hotels) {
      const text = hotelToText(hotel);
      const vector = await embed(text);
      const vectorStr = `[${vector.join(',')}]`;

      await client.query(`
        INSERT INTO document_embeddings (doc_id, doc_type, content, metadata, embedding)
        VALUES ($1, 'hotel', $2, $3, $4)
      `, [
        hotel.id,
        text,
        JSON.stringify({
          id: hotel.id, name: hotel.name, location: hotel.location,
          price: hotel.price, rating: hotel.rating, image: hotel.image,
          featured: hotel.featured,
        }),
        vectorStr,
      ]);
      process.stdout.write(`  ✓ ${hotel.name}\n`);
      totalIndexed++;
    }

    // ── Index destinations ────────────────────────────────────────────────
    const { rows: dests } = await client.query('SELECT * FROM destinations');
    console.log(`\n📦 Indexing ${dests.length} destinations...`);
    for (const dest of dests) {
      const text = destinationToText(dest);
      const vector = await embed(text);
      const vectorStr = `[${vector.join(',')}]`;

      await client.query(`
        INSERT INTO document_embeddings (doc_id, doc_type, content, metadata, embedding)
        VALUES ($1, 'destination', $2, $3, $4)
      `, [
        dest.id,
        text,
        JSON.stringify({
          id: dest.id, name: dest.name, location: dest.location,
          price: dest.price, rating: dest.rating, image: dest.image,
          sub_category: dest.sub_category,
        }),
        vectorStr,
      ]);
      process.stdout.write(`  ✓ ${dest.name}\n`);
      totalIndexed++;
    }

    // ── Index restaurants ──────────────────────────────────────────────────
    const { rows: restos } = await client.query('SELECT * FROM restaurants');
    console.log(`\n📦 Indexing ${restos.length} restaurants...`);
    for (const resto of restos) {
      const text = restaurantToText(resto);
      const vector = await embed(text);
      const vectorStr = `[${vector.join(',')}]`;

      await client.query(`
        INSERT INTO document_embeddings (doc_id, doc_type, content, metadata, embedding)
        VALUES ($1, 'restaurant', $2, $3, $4)
      `, [
        resto.id,
        text,
        JSON.stringify({
          id: resto.id, name: resto.name, location: resto.location,
          price: resto.price, rating: resto.rating, image: resto.image,
          cuisine: resto.cuisine, open_hours: resto.open_hours,
        }),
        vectorStr,
      ]);
      process.stdout.write(`  ✓ ${resto.name}\n`);
      totalIndexed++;
    }

    console.log(`\n🎉 Indexing selesai! Total: ${totalIndexed} dokumen ter-embed`);
    console.log('Server siap pakai RAG. Jalankan: npm run dev\n');

  } catch (err) {
    console.error('❌ Indexing gagal:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

indexAll();
