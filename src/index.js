// require('dotenv').config();
// const express = require('express');
// const cors = require('cors');
// const pool = require('./config/db');
// const { isFirebaseReady } = require('./config/firebase');
 
// // ─── Validasi environment variables ──────────────────────────────────────────
// const requiredEnv = ['JWT_SECRET', 'DATABASE_URL'];
// const missingEnv = requiredEnv.filter(k => !process.env[k]);
// if (missingEnv.length > 0) {
//   console.error(`❌ Missing required env vars: ${missingEnv.join(', ')}`);
//   console.error('Copy .env.example ke .env dan isi nilainya.');
//   process.exit(1);
// }
 
// const OLLAMA_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
// const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:latest';
// const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
 
// async function checkPostgres() {
//   try {
//     const { rows } = await pool.query('SELECT NOW() as time, (SELECT extname FROM pg_extension WHERE extname = $1) as ext', ['vector']);
//     if (rows[0].ext === 'vector') {
//       console.log('✅ PostgreSQL terhubung + pgvector extension aktif');
//     } else {
//       console.warn('⚠️  PostgreSQL terhubung tapi pgvector extension TIDAK aktif');
//       console.warn('   Jalankan: npm run db:init');
//     }
//   } catch (err) {
//     console.error(`❌ PostgreSQL tidak bisa diakses: ${err.message}`);
//     console.error('   Pastikan DBngin PostgreSQL service sudah running');
//     console.error('   Cek DATABASE_URL di .env sudah benar');
//   }
// }
 
// async function checkOllama() {
//   try {
//     const res = await fetch(OLLAMA_URL);
//     const text = await res.text();
//     if (text.includes('Ollama')) {
//       console.log(`✅ Ollama terhubung — chat model: ${OLLAMA_MODEL}, embed model: ${OLLAMA_EMBED_MODEL}`);
//     }
//   } catch {
//     console.warn(`⚠️  Ollama tidak terdeteksi di ${OLLAMA_URL}`);
//     console.warn('   Fitur AI dan RAG tidak akan berfungsi.');
//   }
// }
 
// async function checkEmbeddingCount() {
//   try {
//     const { rows } = await pool.query('SELECT COUNT(*) FROM document_embeddings');
//     const count = Number(rows[0].count);
//     if (count === 0) {
//       console.warn('⚠️  Tabel document_embeddings KOSONG — RAG tidak akan menemukan apapun');
//       console.warn('   Jalankan: npm run rag:index');
//     } else {
//       console.log(`✅ RAG index siap — ${count} dokumen ter-embed`);
//     }
//   } catch {
//     // Tabel mungkin belum ada, sudah di-warn oleh checkPostgres
//   }
// }
 
// const authRoutes         = require('./routes/auth');
// const hotelsRoutes       = require('./routes/hotels');
// const exploreRoutes      = require('./routes/explore');
// const bookingsRoutes     = require('./routes/bookings');
// const checkoutRoutes     = require('./routes/checkout');
// const aiRoutes           = require('./routes/ai');
// const ragRoutes          = require('./routes/rag');
// const notificationsRoutes = require('./routes/notifications');
 
// const app = express();
// const PORT = process.env.PORT || 3000;
 
// app.use(cors({ origin: '*', methods: ['GET','POST','PUT','PATCH','DELETE'], allowedHeaders: ['Content-Type','Authorization'] }));
// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));
 
// // Halaman statis untuk testing (mis. public/push-test.html untuk uji coba
// // push notification secara manual tanpa perlu build app).
// app.use(express.static(require('path').join(__dirname, '..', 'public')));
 
// if (process.env.NODE_ENV === 'development') {
//   app.use((req, _res, next) => {
//     console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
//     next();
//   });
// }
 
// app.use('/api/auth',     authRoutes);
// app.use('/api/hotels',   hotelsRoutes);
// app.use('/api/explore',  exploreRoutes);
// app.use('/api/bookings', bookingsRoutes);
// app.use('/api/checkout', checkoutRoutes);
// app.use('/api/ai',       aiRoutes);
// app.use('/api/rag',      ragRoutes); // endpoint debug RAG
// app.use('/api/notifications', notificationsRoutes);
 
// app.get('/health', async (_req, res) => {
//   const { rows } = await pool.query('SELECT COUNT(*) FROM document_embeddings').catch(() => ({ rows: [{ count: 0 }] }));
//   res.json({
//     status: 'ok',
//     database: 'PostgreSQL + pgvector',
//     ai: 'Ollama (local)',
//     ragDocuments: Number(rows[0].count),
//     timestamp: new Date().toISOString(),
//   });
// });
 
// app.get('/', (_req, res) => {
//   res.json({
//     message: '🌴 Sasacation API — RAG + pgvector + Ollama + Firebase',
//     version: '3.1.0',
//     stack: { database: 'PostgreSQL (DBngin) + pgvector', llm: OLLAMA_MODEL, embedding: OLLAMA_EMBED_MODEL },
//     endpoints: {
//       auth:          'POST /api/auth/login | /register | /social (deprecated) | /firebase | GET /api/auth/me | PATCH /api/auth/location',
//       hotels:        'GET /api/hotels | /api/hotels/nearby?lat=&lng=&radius= | /api/hotels/:id',
//       explore:       'GET /api/explore | /api/explore/categories | /destinations | /restaurants',
//       bookings:      'GET /api/bookings/my | /api/bookings/:id | PATCH /api/bookings/:id/cancel',
//       checkout:      'POST /api/checkout/initiate | /api/checkout/pay | GET /api/checkout/methods',
//       ai:            'POST /api/ai/chat | /api/ai/search | /api/ai/trip-plan | /api/ai/generate-description',
//       rag:           'GET /api/rag/search?q=... (debug endpoint, murni similarity search)',
//       notifications: 'POST /api/notifications/register-token | /test | DELETE /api/notifications/token',
//     },
//   });
// });
 
// app.use((req, res) => res.status(404).json({ success: false, message: `${req.method} ${req.path} tidak ditemukan` }));
 
// app.use((err, _req, res, _next) => {
//   console.error('Unhandled error:', err);
//   res.status(500).json({ success: false, message: 'Server error', ...(process.env.NODE_ENV === 'development' && { error: err.message }) });
// });
 
// app.listen(PORT, async () => {
//   console.log(`\n🌴 Sasacation API (RAG) → http://localhost:${PORT}`);
//   console.log(`📌 Mode: ${process.env.NODE_ENV || 'development'}\n`);
 
//   await checkPostgres();
//   await checkOllama();
//   await checkEmbeddingCount();
//   console.log(isFirebaseReady()
//     ? '✅ Firebase Admin siap — login Firebase & push notification aktif'
//     : '⚠️  Firebase Admin belum dikonfigurasi — isi FIREBASE_SERVICE_ACCOUNT_PATH di .env');
 
//   console.log(`\nAkun default:`);
//   console.log(`  Admin → admin@sasacation.com / admin123`);
//   console.log(`  User  → budi@example.com / admin123\n`);
// });
 
// module.exports = app;
 
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./config/db');
const { isFirebaseReady } = require('./config/firebase');
 
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
 
const authRoutes         = require('./routes/auth');
const hotelsRoutes       = require('./routes/hotels');
const exploreRoutes      = require('./routes/explore');
const bookingsRoutes     = require('./routes/bookings');
const checkoutRoutes     = require('./routes/checkout');
const paymentsRoutes     = require('./routes/payments');
const aiRoutes           = require('./routes/ai');
const ragRoutes          = require('./routes/rag');
const notificationsRoutes = require('./routes/notifications');
const partnersRoutes     = require('./routes/partners');
const wishlistRoutes     = require('./routes/wishlist');
const preferencesRoutes  = require('./routes/preferences');
const chatSessionsRoutes = require('./routes/chatSessions');
const recommendationsRoutes = require('./routes/recommendations');
const walletRoutes     = require('./routes/wallet');
const impactRoutes     = require('./routes/impact');
const paymentMethodsRoutes = require('./routes/paymentMethods');
const settingsRoutes   = require('./routes/settings');
const itinerariesRoutes = require('./routes/itineraries');
const pollsRoutes     = require('./routes/polls');
const groupsRoutes    = require('./routes/groups');
const loyaltyRoutes   = require('./routes/loyalty');
const tasksRoutes     = require('./routes/tasks');
const weatherRoutes   = require('./routes/weather');
const { loginLimiter, aiLimiter, generalLimiter } = require('./middleware/rateLimiter');
 
const app = express();
const PORT = process.env.PORT || 3000;
 
// FIX audit keamanan: sebelumnya `origin: '*'` — mengizinkan domain manapun
// memanggil API ini dari browser. Sekarang whitelist eksplisit lewat env
// ALLOWED_ORIGINS (comma-separated, mis. "https://sasacation.com,https://www.sasacation.com").
// Request TANPA header Origin (app mobile native, curl, Postman, server-to-
// server) selalu diizinkan — CORS itu proteksi level BROWSER, tidak relevan
// untuk native HTTP client, jadi tidak perlu (dan tidak bisa) diblokir di sini.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:3001')
  .split(',')
  .map(o => o.trim());
 
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    console.warn(`[CORS] Origin ditolak: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET','POST','PUT','PATCH','DELETE'],
  allowedHeaders: ['Content-Type','Authorization'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
 
// FIX audit keamanan: sebelumnya TIDAK ADA rate limiting sama sekali.
// generalLimiter berlaku untuk SEMUA endpoint (jaga-jaga dari bot/scraper),
// loginLimiter & aiLimiter lebih ketat khusus untuk titik yang paling
// rawan disalahgunakan (brute-force login, abuse biaya compute AI).
app.use('/api', generalLimiter);
 
// Halaman statis untuk testing (mis. public/push-test.html untuk uji coba
// push notification secara manual tanpa perlu build app).
app.use(express.static(require('path').join(__dirname, '..', 'public')));
 
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
app.use('/api/payments', paymentsRoutes);
app.use('/api/ai',       aiLimiter, aiRoutes);
app.use('/api/rag',      ragRoutes); // endpoint debug RAG
app.use('/api/notifications', notificationsRoutes);
app.use('/api/partners', partnersRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/preferences', preferencesRoutes);
app.use('/api/chat/sessions', chatSessionsRoutes);
app.use('/api/recommendations', recommendationsRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/impact', impactRoutes);
app.use('/api/payment-methods', paymentMethodsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/itineraries', itinerariesRoutes);
app.use('/api/polls', pollsRoutes);
app.use('/api/groups', groupsRoutes);
app.use('/api/loyalty', loyaltyRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/weather', weatherRoutes);
 
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
    message: '🌴 Sasacation API — RAG + pgvector + Ollama + Firebase',
    version: '3.1.0',
    stack: { database: 'PostgreSQL (DBngin) + pgvector', llm: OLLAMA_MODEL, embedding: OLLAMA_EMBED_MODEL },
    endpoints: {
      auth:          'POST /api/auth/login | /register | /social (deprecated) | /firebase | GET /api/auth/me | PATCH /api/auth/location',
      hotels:        'GET /api/hotels | /api/hotels/nearby?lat=&lng=&radius= | /api/hotels/:id | /api/hotels/my (partner) | POST/PUT/DELETE /api/hotels (partner/admin)',
      explore:       'GET /api/explore | /api/explore/categories | /destinations | /restaurants',
      bookings:      'GET /api/bookings/my | /api/bookings/:id | PATCH /api/bookings/:id/cancel',
      checkout:      'POST /api/checkout/initiate | /api/checkout/pay | GET /api/checkout/methods | POST /api/checkout/webhook/midtrans (internal, dipanggil Midtrans)',
      payments:      'GET /api/payments | GET /api/payments/:transactionId/invoice (PDF) | POST /api/payments/:transactionId/refund (admin)',
      ai:            'POST /api/ai/chat | /api/ai/search | /api/ai/trip-plan | /api/ai/compare | /api/ai/generate-description',
      hotelsReviews: 'GET /api/hotels/:id/reviews?page&limit | GET /api/hotels/:id/review-summary | GET /api/preferences/profile | GET /api/recommendations (+profile)',
      rag:           'GET /api/rag/search?q=... (debug endpoint, murni similarity search)',
      notifications: 'POST /api/notifications/register-token | /test | DELETE /api/notifications/token',
      partners:      'POST /api/partners/apply | GET/PUT /api/partners/me | GET /api/partners/admin/all | PATCH /api/partners/admin/:id/approve|reject (admin only)',
      wallet:        'GET /api/wallet | GET /api/wallet/transactions | POST /api/wallet/topup | POST /api/wallet/spend | POST /api/wallet/webhook/midtrans (internal)',
      impact:        'GET /api/impact/summary | GET /api/impact/discovery (auth optional)',
      paymentMethods: 'GET /api/payment-methods | PATCH /api/payment-methods/:id/primary | PATCH /api/payment-methods/:id (label) | DELETE /api/payment-methods/:id',
      settings:       'GET /api/settings | PUT /api/settings',
      itineraries:    'POST /api/itineraries | GET /api/itineraries/my | GET/PUT/DELETE /api/itineraries/:id | POST /api/itineraries/:id/items | PATCH/DELETE /api/itineraries/items/:itemId',
      polls:          'POST /api/polls | GET /api/polls/open | GET /api/polls/my | GET /api/polls/:id | POST /api/polls/:id/vote | PATCH /api/polls/:id/close | DELETE /api/polls/:id',
      groups:         'POST /api/groups | GET /api/groups/my | GET/DELETE /api/groups/:id | POST /api/groups/:id/members | DELETE /api/groups/:id/members/:userId | POST /api/groups/:id/expenses | DELETE /api/groups/:id/expenses/:expenseId',
      loyalty:        'GET /api/loyalty (tier + travel pass)',
      tasks:          'POST /api/tasks | GET /api/tasks/my | PUT /api/tasks/:id | PATCH /api/tasks/:id/done | DELETE /api/tasks/:id',
      weather:        'GET /api/weather?lat=&lng= (publik)',
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
  console.log(isFirebaseReady()
    ? '✅ Firebase Admin siap — login Firebase & push notification aktif'
    : '⚠️  Firebase Admin belum dikonfigurasi — isi FIREBASE_SERVICE_ACCOUNT_PATH di .env');
 
  console.log(`\nAkun default:`);
  console.log(`  Admin → admin@sasacation.com / admin123`);
  console.log(`  User  → budi@example.com / admin123\n`);
});
 
module.exports = app;
 