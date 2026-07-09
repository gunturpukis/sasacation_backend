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
                        CHECK (status IN ('confirmed','cancelled','completed')),
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
                       CHECK (status IN ('success','failed','refunded')),
        paid_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✅ Tabel payments');

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
