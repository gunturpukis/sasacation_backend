# 🌴 Sasacation Backend — RAG + pgvector + Ollama

Versi backend dengan **Retrieval-Augmented Generation (RAG)** menggunakan PostgreSQL + pgvector sebagai vector database, dan Ollama sebagai LLM lokal.

---

## 🏗️ Arsitektur

```
Flutter App → Node.js Backend → PostgreSQL (pgvector) ← embedding → Ollama
                                       ↑
                              similarity search (cosine)
```

- **Database relasional**: users, hotels, destinations, restaurants, bookings, payments
- **Vector database**: tabel `document_embeddings` dengan kolom `vector(768)` — disimpan di PostgreSQL yang SAMA (via extension pgvector), tidak perlu service terpisah
- **Embedding model**: `nomic-embed-text` (via Ollama) — mengubah teks jadi vektor 768 dimensi
- **Chat model**: `llama3.1:latest` (via Ollama) — generate jawaban berdasarkan context RAG

---

## 📦 Setup DBngin (PostgreSQL lokal di macOS)

### 1. Download & Install DBngin
```
https://dbngin.com/
```
Buka DMG, drag ke Applications, jalankan.

### 2. Buat instance PostgreSQL
1. Buka DBngin
2. Klik tombol **"+"** di kiri bawah
3. Pilih **PostgreSQL**, versi terbaru (16.x)
4. Set port: `5432` (default)
5. Klik **Create**
6. Klik tombol **Start** (▶️) pada instance yang baru dibuat

### 3. Aktifkan pgvector extension

DBngin tidak menyertakan pgvector secara default. Install manual:

```bash
# Install pgvector via Homebrew
brew install pgvector

# Cari lokasi PostgreSQL yang dipakai DBngin
# Biasanya di: ~/Library/Application Support/DBngin/postgresql/<version>/bin

# Restart PostgreSQL instance dari DBngin setelah install
```

Kalau `brew install pgvector` tidak otomatis terhubung ke instance DBngin, alternatif termudah:

```bash
# Install PostgreSQL via Homebrew SAJA untuk pgvector supportnya,
# lalu gunakan versi ini alih-alih DBngin
brew install postgresql@16
brew install pgvector
brew services start postgresql@16
```

### 4. Buat database
```bash
# Masuk ke psql
psql postgres

# Di dalam psql:
CREATE DATABASE sasacation_rag;
\q
```

### 5. Test koneksi
```bash
psql postgresql://postgres@localhost:5432/sasacation_rag -c "SELECT version();"
```

---

## 🚀 Setup Backend

### 1. Install dependencies
```bash
cd sasacation-rag
npm install
```

### 2. Setup environment
```bash
cp .env.example .env
```
Edit `.env`, sesuaikan `DATABASE_URL` dengan username PostgreSQL kamu (default DBngin biasanya tanpa password):
```
DATABASE_URL=postgresql://postgres@localhost:5432/sasacation_rag
```

### 3. Pastikan Ollama sudah punya model yang dibutuhkan
```bash
# Model chat (sudah ada dari setup sebelumnya)
ollama list
# Harus ada: llama3.1:latest

# Model embedding — WAJIB di-pull, beda dari model chat
ollama pull nomic-embed-text
```

### 4. Inisialisasi database (buat semua tabel + pgvector)
```bash
npm run db:init
```
Output yang diharapkan:
```
✅ pgvector extension aktif
✅ Tabel users
✅ Tabel hotels
✅ Tabel destinations
✅ Tabel restaurants
✅ Tabel bookings
✅ Tabel payments
✅ Tabel document_embeddings (pgvector 768-dim)
✅ Index HNSW pada embedding column
```

### 5. Isi data awal (hotel, destinasi, restoran, user)
```bash
npm run db:seed
```

### 6. Buat embedding untuk RAG (proses vectorize semua data)
```bash
npm run rag:index
```
Proses ini akan memakan waktu ~30 detik – 1 menit tergantung jumlah data, karena setiap dokumen di-embed satu per satu via Ollama.

### 7. Jalankan server
```bash
npm run dev
```

Output yang diharapkan:
```
🌴 Sasacation API (RAG) → http://localhost:3000
📌 Mode: development

✅ PostgreSQL terhubung + pgvector extension aktif
✅ Ollama terhubung — chat model: llama3.1:latest, embed model: nomic-embed-text
✅ RAG index siap — 11 dokumen ter-embed

Akun default:
  Admin → admin@sasacation.com / admin123
  User  → budi@example.com / admin123
```

---

## 🧪 Testing RAG

### Test similarity search langsung (tanpa LLM)
```bash
curl "http://localhost:3000/api/rag/search?q=hotel%20mewah%20tepi%20pantai&topK=3"
```

### Test chatbot dengan RAG
```bash
# 1. Login dulu untuk dapat token
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"budi@example.com","password":"admin123"}'

# 2. Chat dengan token
curl -X POST http://localhost:3000/api/ai/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN_DARI_LOGIN>" \
  -d '{"messages":[{"role":"user","content":"Rekomendasikan hotel dekat pantai dengan kolam renang"}]}'
```

### Test smart search
```bash
curl -X POST http://localhost:3000/api/ai/search \
  -H "Content-Type: application/json" \
  -d '{"query":"tempat makan seafood enak"}'
```

---

## 🔄 Update data → re-index

Setiap kali kamu menambah/edit hotel, destinasi, atau restoran di database, jalankan ulang:

```bash
npm run rag:index
```

Ini akan menghapus semua embedding lama dan generate ulang dari data terbaru.

---

## 📊 Melihat isi vector database

```bash
psql postgresql://postgres@localhost:5432/sasacation_rag

# Lihat semua dokumen yang ter-embed
SELECT doc_id, doc_type, LEFT(content, 60) as preview FROM document_embeddings;

# Cek dimensi vector (harus 768)
SELECT doc_type, vector_dims(embedding) FROM document_embeddings LIMIT 1;

# Test similarity search manual di SQL
SELECT doc_type, metadata->>'name' as name, 
       1 - (embedding <=> (SELECT embedding FROM document_embeddings LIMIT 1)) as similarity
FROM document_embeddings
ORDER BY similarity DESC
LIMIT 5;
```

---

## 🛠️ Troubleshooting

| Masalah | Solusi |
|---|---|
| `extension "vector" does not exist` | pgvector belum terinstall. Lihat langkah 3 di atas |
| `RAG index kosong` | Jalankan `npm run rag:index` |
| `Ollama tidak terdeteksi` | Cek `ollama list`, pastikan service jalan |
| Similarity selalu rendah | Cek model embed konsisten — jangan campur model berbeda saat index vs query |
| `column "embedding" is of type vector but expression is of type text` | Pastikan format vector `[0.1,0.2,...]` sebagai string, bukan array JS langsung |

---

## 📁 Struktur Project

```
sasacation-rag/
├── src/
│   ├── config/
│   │   ├── db.js           # koneksi pool PostgreSQL
│   │   ├── initDB.js        # buat semua tabel + pgvector extension
│   │   └── seedDB.js        # isi data awal
│   ├── services/
│   │   ├── ragService.js    # core retrieval logic (embed query + similarity search)
│   │   ├── ragIndexer.js    # embed semua dokumen → simpan ke pgvector
│   │   └── aiService.js     # 4 fitur AI, semua pakai RAG
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── hotelsController.js
│   │   └── aiController.js
│   ├── middleware/auth.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── hotels.js
│   │   ├── ai.js
│   │   └── rag.js           # debug endpoint similarity search
│   └── index.js
├── .env.example
└── package.json
```
