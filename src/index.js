require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./config/db');

// ─── Validasi environment variables ──────────────────────────────────────────
const requiredEnv = ['JWT_SECRET', 'DATABASE_URL'];
const missingEnv = requiredEnv.filter(k => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(`❌ Missing required env vars: ${missingEnv.join(', ')}`);
  console.error('Copy .env.example ke .env dan isi nilainya.');
  process.exit(1);
}

const OLLAMA_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:latest';
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';

async function checkPostgres() {
  try {
    const { rows } = await pool.query('SELECT NOW() as time, (SELECT extname FROM pg_extension WHERE extname = $1) as ext', ['vector']);
    if (rows[0].ext === 'vector') {
      console.log('✅ PostgreSQL terhubung + pgvector extension aktif');
    } else {
      console.warn('⚠️  PostgreSQL terhubung tapi pgvector extension TIDAK aktif');
      console.warn('   Jalankan: npm run db:init');
    }
  } catch (err) {
    console.error(`❌ PostgreSQL tidak bisa diakses: ${err.message}`);
    console.error('   Pastikan DBngin PostgreSQL service sudah running');
    console.error('   Cek DATABASE_URL di .env sudah benar');
  }
}

async function checkOllama() {
  try {
    const res = await fetch(OLLAMA_URL);
    const text = await res.text();
    if (text.includes('Ollama')) {
      console.log(`✅ Ollama terhubung — chat model: ${OLLAMA_MODEL}, embed model: ${OLLAMA_EMBED_MODEL}`);
    }
  } catch {
    console.warn(`⚠️  Ollama tidak terdeteksi di ${OLLAMA_URL}`);
    console.warn('   Fitur AI dan RAG tidak akan berfungsi.');
  }
}

async function checkEmbeddingCount() {
  try {
    const { rows } = await pool.query('SELECT COUNT(*) FROM document_embeddings');
    const count = Number(rows[0].count);
    if (count === 0) {
      console.warn('⚠️  Tabel document_embeddings KOSONG — RAG tidak akan menemukan apapun');
      console.warn('   Jalankan: npm run rag:index');
    } else {
      console.log(`✅ RAG index siap — ${count} dokumen ter-embed`);
    }
  } catch {
    // Tabel mungkin belum ada, sudah di-warn oleh checkPostgres
  }
}

const authRoutes     = require('./routes/auth');
const hotelsRoutes   = require('./routes/hotels');
const exploreRoutes  = require('./routes/explore');
const bookingsRoutes = require('./routes/bookings');
const checkoutRoutes = require('./routes/checkout');
const aiRoutes       = require('./routes/ai');
const ragRoutes      = require('./routes/rag');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*', methods: ['GET','POST','PUT','PATCH','DELETE'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV === 'development') {
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
}

app.use('/api/auth',     authRoutes);
app.use('/api/hotels',   hotelsRoutes);
app.use('/api/explore',  exploreRoutes);
app.use('/api/bookings', bookingsRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/ai',       aiRoutes);
app.use('/api/rag',      ragRoutes); // endpoint debug RAG

app.get('/health', async (_req, res) => {
  const { rows } = await pool.query('SELECT COUNT(*) FROM document_embeddings').catch(() => ({ rows: [{ count: 0 }] }));
  res.json({
    status: 'ok',
    database: 'PostgreSQL + pgvector',
    ai: 'Ollama (local)',
    ragDocuments: Number(rows[0].count),
    timestamp: new Date().toISOString(),
  });
});

app.get('/', (_req, res) => {
  res.json({
    message: '🌴 Sasacation API — RAG + pgvector + Ollama',
    version: '3.0.0',
    stack: { database: 'PostgreSQL (DBngin) + pgvector', llm: OLLAMA_MODEL, embedding: OLLAMA_EMBED_MODEL },
    endpoints: {
      auth:     'POST /api/auth/login | /register | /social | GET /api/auth/me',
      hotels:   'GET /api/hotels | /api/hotels/:id',
      explore:  'GET /api/explore | /api/explore/categories | /destinations | /restaurants',
      bookings: 'GET /api/bookings/my | /api/bookings/:id | PATCH /api/bookings/:id/cancel',
      checkout: 'POST /api/checkout/initiate | /api/checkout/pay | GET /api/checkout/methods',
      ai:       'POST /api/ai/chat | /api/ai/search | /api/ai/trip-plan | /api/ai/generate-description',
      rag:      'GET /api/rag/search?q=... (debug endpoint, murni similarity search)',
    },
  });
});

app.use((req, res) => res.status(404).json({ success: false, message: `${req.method} ${req.path} tidak ditemukan` }));

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Server error', ...(process.env.NODE_ENV === 'development' && { error: err.message }) });
});

app.listen(PORT, async () => {
  console.log(`\n🌴 Sasacation API (RAG) → http://localhost:${PORT}`);
  console.log(`📌 Mode: ${process.env.NODE_ENV || 'development'}\n`);

  await checkPostgres();
  await checkOllama();
  await checkEmbeddingCount();

  console.log(`\nAkun default:`);
  console.log(`  Admin → admin@sasacation.com / admin123`);
  console.log(`  User  → budi@example.com / admin123\n`);
});

module.exports = app;
