require('dotenv').config();
const express = require('express');
const cors = require('cors');

// ─── Validate required env vars ──────────────────────────────────────────────
const requiredEnv = ['JWT_SECRET'];
const missingEnv = requiredEnv.filter(k => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(`❌ Missing required env vars: ${missingEnv.join(', ')}`);
  console.error('Copy .env.example to .env and fill in values.');
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('⚠️  ANTHROPIC_API_KEY not set — AI features will not work.');
}

const authRoutes     = require('./routes/auth');
const hotelsRoutes   = require('./routes/hotels');
const exploreRoutes  = require('./routes/explore');
const bookingsRoutes = require('./routes/bookings');
const aiRoutes       = require('./routes/ai');
const checkoutRoutes = require('./routes/checkout');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','PATCH','DELETE'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV === 'development') {
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
}

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/hotels',   hotelsRoutes);
app.use('/api/explore',  exploreRoutes);
app.use('/api/bookings', bookingsRoutes);
app.use('/api/ai',       aiRoutes);
app.use('/api/checkout', checkoutRoutes);

// ─── Health & root ───────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.get('/', (_req, res) => res.json({
  message: '🌴 Sasacation API',
  version: '1.0.0',
  endpoints: {
    auth:     'POST /api/auth/login | /register | /social | GET /api/auth/me',
    hotels:   'GET /api/hotels | /api/hotels/:id',
    explore:  'GET /api/explore | /api/explore/categories | /destinations | /restaurants',
    bookings: 'GET /api/bookings/my | POST /api/bookings | PATCH /api/bookings/:id/cancel',
    checkout: 'POST /api/checkout/initiate | /api/checkout/pay | GET /api/checkout/methods',
    ai:       'POST /api/ai/chat | /api/ai/search | /api/ai/trip-plan | /api/ai/generate-description',
  },
}));

// ─── 404 & Error handlers ─────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ success: false, message: `${req.method} ${req.path} tidak ditemukan` }));

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Server error', ...(process.env.NODE_ENV === 'development' && { error: err.message }) });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🌴 Sasacation API → http://localhost:${PORT}`);
  console.log(`📌 Mode: ${process.env.NODE_ENV || 'development'}`);
  console.log(`\nAkun default:`);
  console.log(`  Admin → admin@sasacation.com / admin123`);
  console.log(`  User  → budi@example.com / admin123\n`);
});

module.exports = app;
