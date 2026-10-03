// src/config/migrateLegacy.js
// Konsolidasi gap initDB (ditemukan saat fresh install Okt 2026): beberapa
// tabel/kolom yang selama ini hanya lahir via migrasi terpisah tidak ikut
// terbuat oleh db:init, sehingga install baru rusak di endpoint
// wishlist/preferences/notifications/chat/partners.
// Isi = UNION dari migrateUserData + migrateNotifications + migrateChatMemory
// + bagian partners yang relevan, dibuat idempotent (aman di DB lama maupun
// baru). initDB.js sudah diselaraskan dengan isi yang sama untuk install
// berikutnya.
//
// Jalankan: npm run db:migrate:legacy

require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔧 Menambal gap initDB...\n');
    await client.query('BEGIN');

    // 1. users.role: mitra butuh 'partner'
    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
        ALTER TABLE users ADD CONSTRAINT users_role_check
          CHECK (role IN ('user','admin','partner'));
      END $$;
    `);
    console.log("✅ users.role menerima 'partner'");

    // 2. properties (B2B) + relasi hotels.property_id
    await client.query(`
      CREATE TABLE IF NOT EXISTS properties (
        id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        business_name TEXT        NOT NULL,
        description   TEXT,
        phone         TEXT,
        address       TEXT,
        status        TEXT        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending','verified','rejected','suspended')),
        rejection_reason TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_properties_owner ON properties(owner_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status)`);
    await client.query(`ALTER TABLE hotels ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE SET NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_hotels_property ON hotels(property_id)`);
    console.log('✅ Tabel properties + hotels.property_id');

    // 3. payments: payload gateway + paid_at boleh NULL (pending belum dibayar)
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway_response JSONB`);
    await client.query(`ALTER TABLE payments ALTER COLUMN paid_at DROP NOT NULL`);
    await client.query(`ALTER TABLE payments ALTER COLUMN paid_at DROP DEFAULT`);
    console.log('✅ Kolom payments.gateway_response + paid_at nullable');

    // 4. wishlist
    await client.query(`
      CREATE TABLE IF NOT EXISTS wishlist (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        hotel_id   UUID        NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, hotel_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_wishlist_user ON wishlist(user_id)`);
    console.log('✅ Tabel wishlist');

    // 5. user_preferences (termasuk styles P5)
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id           UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        budget_min         NUMERIC,
        budget_max         NUMERIC,
        preferred_group_type TEXT     CHECK (preferred_group_type IN ('solo','couple','family','friends')),
        min_star_rating    NUMERIC,
        interests          TEXT[]     DEFAULT '{}',
        dislikes           TEXT[]     DEFAULT '{}',
        styles             TEXT[]     DEFAULT '{}',
        raw_signals        JSONB      DEFAULT '[]',
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS styles TEXT[] DEFAULT '{}'`);
    console.log('✅ Tabel user_preferences (+styles)');

    // 6. notifications
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title      TEXT        NOT NULL,
        body       TEXT        NOT NULL,
        type       TEXT        NOT NULL DEFAULT 'general',
        data       JSONB       DEFAULT '{}',
        read_at    TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_user_created
        ON notifications(user_id, created_at DESC)
    `);
    console.log('✅ Tabel notifications');

    // 7. chat memory
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title      TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID        NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role       TEXT        NOT NULL CHECK (role IN ('user','assistant')),
        content    TEXT        NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_updated
        ON chat_sessions(user_id, updated_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_messages_session
        ON chat_messages(session_id, created_at)
    `);
    console.log('✅ Tabel chat_sessions + chat_messages');

    await client.query('COMMIT');
    console.log('\n🎉 Tambalan selesai — skema kini setara DB lama.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migrasi gagal:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
