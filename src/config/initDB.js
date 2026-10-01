// src/config/initDB.js
// Jalankan sekali: npm run db:init
// Membuat semua tabel PostgreSQL + mengaktifkan pgvector extension

require('dotenv').config();
const pool = require('./db');

async function initDB() {
  const client = await pool.connect();
  try {
    console.log('🔧 Membuat schema database Sasacation...\n');

    await client.query('BEGIN');

    // ── Aktifkan pgvector extension ──────────────────────────────────────────
    // Harus dilakukan sebelum CREATE TABLE yang pakai tipe vector
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    console.log('✅ pgvector extension aktif');

    // ── Users ────────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        name        TEXT        NOT NULL,
        email       TEXT        UNIQUE NOT NULL,
        password    TEXT,
        role        TEXT        NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
        avatar      TEXT,
        provider    TEXT        NOT NULL DEFAULT 'email',
        provider_id TEXT,
        firebase_uid TEXT       UNIQUE,
        fcm_token    TEXT,
        fcm_platform TEXT,
        latitude     NUMERIC,
        longitude    NUMERIC,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel users');

    // ── Hotels ───────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS hotels (
        id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        name         TEXT        NOT NULL,
        location     TEXT        NOT NULL,
        address      TEXT,
        price        NUMERIC     NOT NULL,
        rating       NUMERIC     DEFAULT 0,
        review_count INT         DEFAULT 0,
        image        TEXT        DEFAULT '',
        images       TEXT[]      DEFAULT '{}',
        description  TEXT,
        amenities    TEXT[]      DEFAULT '{}',
        featured     BOOLEAN     DEFAULT false,
        available    BOOLEAN     DEFAULT true,
        // P3 (FLUTTER_P3_CONTRACTS.md): flag usaha lokal untuk Impact Score.
        // Lihat src/config/migrateImpact.js untuk DB yang sudah ada.
        is_local_business BOOLEAN NOT NULL DEFAULT false,
        // B4 (audit Figma): rincian "Cleaning fee" di Price Summary.
        cleaning_fee NUMERIC NOT NULL DEFAULT 0,
        latitude     NUMERIC,
        longitude    NUMERIC,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel hotels');

    // ── Destinations ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS destinations (
        id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        name         TEXT        NOT NULL,
        location     TEXT        NOT NULL,
        address      TEXT,
        price        NUMERIC     DEFAULT 0,
        rating       NUMERIC     DEFAULT 0,
        review_count INT         DEFAULT 0,
        image        TEXT        DEFAULT '',
        images       TEXT[]      DEFAULT '{}',
        description  TEXT,
        sub_category TEXT        CHECK (sub_category IN ('Beaches','Islands','Adventure','Culture')),
        latitude     NUMERIC,
        longitude    NUMERIC,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel destinations');

    // ── Restaurants ───────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS restaurants (
        id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        name         TEXT        NOT NULL,
        location     TEXT        NOT NULL,
        address      TEXT,
        price        NUMERIC     DEFAULT 0,
        rating       NUMERIC     DEFAULT 0,
        review_count INT         DEFAULT 0,
        image        TEXT        DEFAULT '',
        images       TEXT[]      DEFAULT '{}',
        description  TEXT,
        cuisine      TEXT,
        open_hours   TEXT,
        latitude     NUMERIC,
        longitude    NUMERIC,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel restaurants');

    // ── Bookings ──────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_code    TEXT        UNIQUE NOT NULL,
        user_id         UUID        NOT NULL REFERENCES users(id),
        hotel_id        UUID        NOT NULL REFERENCES hotels(id),
        check_in        TIMESTAMPTZ NOT NULL,
        check_out       TIMESTAMPTZ NOT NULL,
        nights          INT         NOT NULL,
        guest_count     INT         NOT NULL,
        price_per_night NUMERIC     NOT NULL,
        total_price     NUMERIC     NOT NULL,
        notes           TEXT,
        status          TEXT        NOT NULL DEFAULT 'confirmed'
                        CHECK (status IN ('pending','confirmed','cancelled','completed')),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel bookings');

    // ── Payments ──────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id TEXT        UNIQUE NOT NULL,
        booking_id     UUID        UNIQUE NOT NULL REFERENCES bookings(id),
        user_id        UUID        NOT NULL REFERENCES users(id),
        method         TEXT        NOT NULL,
        amount         NUMERIC     NOT NULL,
        currency       TEXT        DEFAULT 'USD',
        status         TEXT        NOT NULL DEFAULT 'success'
                        CHECK (status IN ('pending','success','failed','refunded')),
        paid_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        // B1: data Snap untuk resume pembayaran pending dari My Trips.
        snap_token     TEXT,
        redirect_url   TEXT,
        snap_expires_at TIMESTAMPTZ
      )
    `);
    console.log('✅ Tabel payments');

    // ── Reviews (P1 FLUTTER_P3_CONTRACTS.md) ─────────────────────────────────
    // Guest Reviews untuk GET /hotels/:id. Tabel terpisah (bukan kolom JSON)
    // supaya bisa JOIN + filter "tanpa teks di-skip" di level SQL. Lihat juga
    // src/config/migrateReviews.js untuk DB yang sudah ada.
    await client.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        hotel_id   UUID        NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
        user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
        user_name  TEXT        NOT NULL,
        avatar     TEXT,
        rating     NUMERIC(2,1) NOT NULL CHECK (rating >= 1 AND rating <= 5),
        stayed     TEXT,
        text       TEXT        NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel reviews');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_reviews_hotel_created
        ON reviews(hotel_id, created_at DESC)
    `);

    // ── Travel Wallet (P2 FLUTTER_P3_CONTRACTS.md) ───────────────────────────
    // Saldo tersimpan + riwayat khusus wallet (terpisah dari `payments` yang
    // bersifat per-transaksi booking) + poin loyalitas. Lihat juga
    // src/config/migrateWallet.js untuk DB yang sudah ada.
    await client.query(`
      CREATE TABLE IF NOT EXISTS wallets (
        user_id        UUID   PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        balance_cents  BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
        currency       TEXT   NOT NULL DEFAULT 'USD',
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel wallets');

    await client.query(`
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id             UUID   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type                TEXT   NOT NULL CHECK (type IN ('topup','spend','refund','adjustment','transfer_in','transfer_out')),
        amount_cents        BIGINT NOT NULL CHECK (amount_cents <> 0),
        balance_after_cents BIGINT,
        label               TEXT,
        reference_id        TEXT   UNIQUE,
        status              TEXT   NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','success','failed')),
        metadata            JSONB  DEFAULT '{}',
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel wallet_transactions');

    await client.query(`
      CREATE TABLE IF NOT EXISTS loyalty_points (
        user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        points     INT  NOT NULL DEFAULT 0 CHECK (points >= 0),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel loyalty_points');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_created
        ON wallet_transactions(user_id, created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_wallet_tx_reference
        ON wallet_transactions(reference_id)
    `);

    // ── Saved Payment Methods (P4 FLUTTER_P3_CONTRACTS.md) ───────────────────
    // Token vault Midtrans (saved_token_id), BUKAN nomor kartu. Kartu tersimpan
    // saat checkout dengan save_card=true + sukses webhook. Lihat juga
    // src/config/migratePaymentMethods.js untuk DB yang sudah ada.
    await client.query(`
      CREATE TABLE IF NOT EXISTS payment_methods (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        brand           TEXT NOT NULL DEFAULT 'unknown'
                        CHECK (brand IN ('visa','mastercard','amex','jcb','unknown')),
        last4           TEXT NOT NULL CHECK (last4 ~ '^[0-9]{4}$'),
        exp_month       INT  CHECK (exp_month BETWEEN 1 AND 12),
        exp_year        INT,
        saved_token_id  TEXT NOT NULL,
        token_expires_at TIMESTAMPTZ,
        is_primary      BOOLEAN NOT NULL DEFAULT false,
        // B4: julukan kartu ("Business") seperti layar wallet Figma.
        label           TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, saved_token_id)
      )
    `);
    console.log('✅ Tabel payment_methods');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_payment_methods_user
        ON payment_methods(user_id, created_at DESC)
    `);

    // ── User Settings (B4 audit Figma) ───────────────────────────────────────
    // Toggle layar Settings: push, personalisasi AI, bahasa.
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        push_enabled       BOOLEAN NOT NULL DEFAULT true,
        ai_personalization BOOLEAN NOT NULL DEFAULT true,
        language           TEXT    NOT NULL DEFAULT 'en' CHECK (language IN ('en','id')),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel user_settings');

    // ── Itineraries (A5 audit Figma) ─────────────────────────────────────────
    // Simpan hasil trip-plan AI supaya bisa dibuka dari nav Itinerary.
    await client.query(`
      CREATE TABLE IF NOT EXISTS itineraries (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title      TEXT NOT NULL,
        destination TEXT,
        start_date DATE,
        end_date   DATE,
        status     TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','active','completed','cancelled')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel itineraries');

    await client.query(`
      CREATE TABLE IF NOT EXISTS itinerary_items (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        itinerary_id UUID NOT NULL REFERENCES itineraries(id) ON DELETE CASCADE,
        day          INT  NOT NULL DEFAULT 1 CHECK (day >= 1),
        time         TEXT,
        title        TEXT NOT NULL,
        description  TEXT,
        location     TEXT,
        kind         TEXT NOT NULL DEFAULT 'activity'
                     CHECK (kind IN ('activity','meal','rest','transport','stay')),
        position     INT  NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel itinerary_items');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_itineraries_user ON itineraries(user_id, created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_itinerary_items_parent
        ON itinerary_items(itinerary_id, day, position)
    `);

    // ── Polls (A1 audit Figma) ───────────────────────────────────────────────
    // Vote grup ("New Vote: Sunset Dinner → Vote now").
    await client.query(`
      CREATE TABLE IF NOT EXISTS polls (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title       TEXT NOT NULL,
        description TEXT,
        status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
        closes_at   TIMESTAMPTZ,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel polls');

    await client.query(`
      CREATE TABLE IF NOT EXISTS poll_options (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        poll_id    UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
        label      TEXT NOT NULL,
        position   INT  NOT NULL DEFAULT 0
      )
    `);
    console.log('✅ Tabel poll_options');

    await client.query(`
      CREATE TABLE IF NOT EXISTS poll_votes (
        poll_id    UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
        option_id  UUID NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
        user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (poll_id, user_id)
      )
    `);
    console.log('✅ Tabel poll_votes');

    await client.query(`CREATE INDEX IF NOT EXISTS idx_polls_open ON polls(status, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_poll_options_poll ON poll_options(poll_id, position)`);

    // ── Group Budget (A2 audit Figma) ────────────────────────────────────────
    // Grup trip + budget bersama + pengeluaran ("Group Budget Equity").
    await client.query(`
      CREATE TABLE IF NOT EXISTS trip_groups (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        destination  TEXT,
        budget_total NUMERIC NOT NULL DEFAULT 0 CHECK (budget_total >= 0),
        currency     TEXT NOT NULL DEFAULT 'USD',
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel trip_groups');

    await client.query(`
      CREATE TABLE IF NOT EXISTS group_members (
        group_id  UUID NOT NULL REFERENCES trip_groups(id) ON DELETE CASCADE,
        user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (group_id, user_id)
      )
    `);
    console.log('✅ Tabel group_members');

    await client.query(`
      CREATE TABLE IF NOT EXISTS group_expenses (
        id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id  UUID NOT NULL REFERENCES trip_groups(id) ON DELETE CASCADE,
        user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        label     TEXT NOT NULL,
        amount    NUMERIC NOT NULL CHECK (amount > 0),
        category  TEXT,
        spent_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel group_expenses');

    await client.query(`CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_group_expenses_group ON group_expenses(group_id, spent_at DESC)`);

    // ── Travel Tasks (A3 audit Figma) ────────────────────────────────────────
    // Pengingat perjalanan ("Check-in Open GA-421").
    await client.query(`
      CREATE TABLE IF NOT EXISTS travel_tasks (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
        kind       TEXT NOT NULL DEFAULT 'reminder'
                   CHECK (kind IN ('flight_checkin','reminder','payment','document','other')),
        title      TEXT NOT NULL,
        detail     TEXT,
        due_at     TIMESTAMPTZ,
        payload    JSONB DEFAULT '{}',
        done       BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel travel_tasks');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_travel_tasks_user_due
        ON travel_tasks(user_id, done, due_at)
    `);

    // ────────────────────────────────────────────────────────────────────────
    // ── RAG: Tabel document_embeddings (inti dari pgvector) ─────────────────
    // Menyimpan semua dokumen Sasacation beserta embedding vector-nya
    // Dimensi 768 sesuai model nomic-embed-text dari Ollama
    // ────────────────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS document_embeddings (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        doc_id      TEXT        NOT NULL,
        doc_type    TEXT        NOT NULL CHECK (doc_type IN ('hotel','destination','restaurant')),
        content     TEXT        NOT NULL,
        metadata    JSONB       DEFAULT '{}',
        embedding   vector(768) NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel document_embeddings (pgvector 768-dim)');

    // ── Index HNSW untuk similarity search yang cepat ────────────────────────
    // HNSW (Hierarchical Navigable Small World) jauh lebih cepat dari IVFFlat
    // untuk dataset kecil-menengah seperti Sasacation
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw
        ON document_embeddings
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
    `);
    console.log('✅ Index HNSW pada embedding column');

    // Index tambahan untuk filter cepat berdasarkan doc_type
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_embeddings_doc_type
        ON document_embeddings(doc_type)
    `);

    await client.query('COMMIT');
    console.log('\n🎉 Schema database berhasil dibuat!');
    console.log('Langkah selanjutnya:');
    console.log('  1. npm run db:seed    — isi data hotel, destinasi, restoran');
    console.log('  2. npm run rag:index  — buat embedding semua dokumen');
    console.log('  3. npm run dev        — jalankan server\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error membuat schema:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

initDB();
