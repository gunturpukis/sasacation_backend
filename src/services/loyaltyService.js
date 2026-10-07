// src/services/loyaltyService.js
// Loyalty Ledger (LOYALTY_DEFINITION.md, disetujui 04 Okt 2026).
//
// Keputusan produk: loyalty points SAJA, bukan e-money. Saldo = SUM ledger
// yang belum kedaluwarsa; kolom `loyalty_points.points` dipertahankan sebagai
// cache/kompatibilitas (duit lama + money.test) dan disinkronkan di sini.
//
// Aturan dari definisi:
// - Perolehan: register +50, review +25, booking completed 1/Rp10.000,
//   top-up $1 = 1 poin (legasi, dual-write). Sistem saja yang menambah —
//   TIDAK PERNAH dari input client langsung.
// - Penukaran: 100 poin = Rp10.000, minimal 100, maksimal 50% subtotal,
//   kelipatan 100. Kedaluwarsa 12 bulan.
// - Tier: Bronze <100, Silver 100+, Gold 500+, Platinum 2000+.
//
// HOOK DITUNDA (jujur, bukan diam): earn_review (belum ada POST /reviews)
// dan earn_booking (belum ada transisi completed) — lihat migrateLoyaltyLedger.js.

const pool = require('../config/db');

const WELCOME_POINTS = 50;
const REVIEW_POINTS = 25;
const MIN_REDEEM = 100;
const MAX_PCT = 50; // % subtotal
const EXPIRY_MONTHS = 12;
const EXPIRING_SOON_DAYS = 30;

function usdToIdrRate() {
  return Number(process.env.MIDTRANS_USD_TO_IDR_RATE || 16000);
}

function tierFor(points) {
  if (points >= 2000) return 'Platinum';
  if (points >= 500) return 'Gold';
  if (points >= 100) return 'Silver';
  return 'Bronze';
}

// 100 poin = Rp10.000 → discount USD = points * 100 / rate. Selalu bulatkan
// ke bawah ke sen agar tidak pernah diskon lebih dari hak.
function discountUsdFor(points, rate = usdToIdrRate()) {
  return Math.floor((points * 100 / rate) * 100) / 100;
}

function conversion(rate = usdToIdrRate()) {
  return {
    points_per_10000_idr: 100,
    min_redeem: MIN_REDEEM,
    max_pct: MAX_PCT,
    usd_to_idr_rate: rate,
  };
}

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

// Validasi murni (DB-free, diuji di tests/loyalty.test.js).
function validateRedeemQty(redeemPoints) {
  if (!Number.isInteger(redeemPoints) || redeemPoints < MIN_REDEEM)
    fail(400, `redeem_points minimal ${MIN_REDEEM}`);
  if (redeemPoints % 100 !== 0)
    fail(400, 'redeem_points harus kelipatan 100');
}

// Kuotasi redeem murni: berapa poin yang BISA dipakai untuk subtotal ini.
// Melempar 400 bila qty invalid / saldo kurang / subtotal tidak positif.
function quoteRedeem({ balance, redeemPoints, subtotalUsd, rate = usdToIdrRate() }) {
  validateRedeemQty(redeemPoints);
  if (!Number.isFinite(subtotalUsd) || subtotalUsd <= 0)
    fail(400, 'subtotal tidak valid untuk redeem');
  if (redeemPoints > balance)
    fail(400, `Poin tidak cukup (saldo ${balance})`);
  const maxDiscount = subtotalUsd * (MAX_PCT / 100);
  const wanted = discountUsdFor(redeemPoints, rate);
  // Kurangi poin sampai diskon muat dalam 50% subtotal (tetap kelipatan 100).
  let pts = redeemPoints;
  while (pts >= MIN_REDEEM && discountUsdFor(pts, rate) > maxDiscount) pts -= 100;
  if (pts < MIN_REDEEM)
    fail(400, `Subtotal $${subtotalUsd} terlalu kecil untuk redeem minimal (maks 50% subtotal)`);
  return { redeemPoints: pts, discountUsd: discountUsdFor(pts, rate) };
}

function isLedgerMissing(e) {
  return e && (e.code === '42P01' || e.code === '42703');
}

async function legacyPoints(db, userId) {
  try {
    const { rows } = await db.query('SELECT points FROM loyalty_points WHERE user_id = $1', [userId]);
    return Number(rows[0]?.points ?? 0);
  } catch (e) {
    if (isLedgerMissing(e)) return 0;
    throw e;
  }
}

async function bumpLegacy(db, userId, delta) {
  try {
    await db.query(
      `INSERT INTO loyalty_points (user_id, points) VALUES ($1, GREATEST($2, 0))
       ON CONFLICT (user_id) DO UPDATE SET
         points = GREATEST(loyalty_points.points + $2, 0), updated_at = NOW()`,
      [userId, delta]
    );
  } catch (e) {
    if (!isLedgerMissing(e)) throw e;
  }
}

// Satu kali: pindahkan saldo legasi ke ledger agar SUM konsisten ke depan.
// Poin migrasi tidak kedaluwarsa (hak yang sudah diperoleh sebelum aturan
// expiry ada — keputusan sadar, bukan lupa).
async function ensureMigrated(db, userId) {
  const { rows } = await db.query('SELECT COUNT(*) AS n FROM loyalty_ledger WHERE user_id = $1', [userId]);
  if (Number(rows[0].n) > 0) return;
  const legacy = await legacyPoints(db, userId);
  if (legacy > 0) {
    await db.query(
      `INSERT INTO loyalty_ledger (user_id, points, type, reference_id, note)
       VALUES ($1, $2, 'legacy_migration', $3, $4) ON CONFLICT (reference_id) DO NOTHING`,
      [userId, legacy, `legacy:${userId}`, 'Migrasi saldo poin lama ke ledger']
    );
  }
}

// Saldo = perolehan belum kedaluwarsa + semua baris negatif (spend/transfer/
// redeem tidak kedaluwarsa — mereka pencatatan, bukan hak).
async function getBalance(db, userId) {
  try {
    await ensureMigrated(db, userId);
    const { rows } = await db.query(
      `SELECT COALESCE(SUM(points), 0) AS balance FROM loyalty_ledger
        WHERE user_id = $1 AND (points < 0 OR expires_at IS NULL OR expires_at > NOW())`,
      [userId]
    );
    return Math.max(0, Number(rows[0].balance));
  } catch (e) {
    if (isLedgerMissing(e)) return Math.max(0, await legacyPoints(db, userId));
    throw e;
  }
}

async function getExpiringSoon(db, userId, days = EXPIRING_SOON_DAYS) {
  try {
    await ensureMigrated(db, userId);
    const { rows } = await db.query(
      `SELECT COALESCE(SUM(points), 0) AS exp FROM loyalty_ledger
        WHERE user_id = $1 AND points > 0 AND expires_at IS NOT NULL
          AND expires_at > NOW() AND expires_at <= NOW() + ($2 || ' days')::interval`,
      [userId, String(days)]
    );
    return Math.max(0, Number(rows[0].exp));
  } catch (e) {
    if (isLedgerMissing(e)) return 0;
    throw e;
  }
}

function expiryDate(months = EXPIRY_MONTHS) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

async function addEarn(db, userId, points, type, { referenceId = null, note = null, expiresAt = null } = {}) {
  if (!Number.isInteger(points) || points <= 0) fail(400, 'poin earn harus bilangan positif');
  const exp = expiresAt === null && type.startsWith('earn_') ? expiryDate() : expiresAt;
  const { rows } = await db.query(
    `INSERT INTO loyalty_ledger (user_id, points, type, reference_id, note, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (reference_id) DO NOTHING RETURNING *`,
    [userId, points, type, referenceId, note, exp]
  );
  if (rows[0]) await bumpLegacy(db, userId, points);
  return rows[0] || null; // null = idempotent skip (sudah pernah dicatat)
}

// Welcome bonus — idempotent per user, dipanggil saat registrasi baru.
async function awardWelcome(db, userId) {
  try {
    return await addEarn(db, userId, WELCOME_POINTS, 'earn_register', {
      referenceId: `welcome:${userId}`,
      note: 'Bonus selamat datang 50 poin',
    });
  } catch (e) {
    if (isLedgerMissing(e)) {
      await bumpLegacy(db, userId, WELCOME_POINTS); // DB lama: legasi saja
      return null;
    }
    throw e;
  }
}

// Kurangi saldo (redeem/transfer_out). Harus dalam transaksi milik pemanggil.
async function spendPoints(db, userId, points, type, { referenceId = null, note = null } = {}) {
  validateRedeemQty(points);
  const balance = await getBalance(db, userId);
  if (points > balance) fail(400, `Poin tidak cukup (saldo ${balance})`);
  const { rows } = await db.query(
    `INSERT INTO loyalty_ledger (user_id, points, type, reference_id, note)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (reference_id) DO NOTHING RETURNING *`,
    [userId, -points, type, referenceId, note]
  );
  if (rows[0]) await bumpLegacy(db, userId, -points);
  return rows[0] || null;
}

// Transfer poin antar user — atomik. Dipanggil dengan client transaksi ATAU
// pool (fungsi ini BEGIN/COMMIT sendiri bila diberi pool).
async function transferPoints(dbOrPool, fromId, toEmail, points, note = null) {
  if (!Number.isInteger(points) || points < MIN_REDEEM)
    fail(400, `transfer minimal ${MIN_REDEEM} poin`);
  if (points % 100 !== 0) fail(400, 'transfer harus kelipatan 100');
  const owned = dbOrPool === pool;
  const db = owned ? await pool.connect() : dbOrPool;
  try {
    if (owned) await db.query('BEGIN');
    const { rows: uRows } = await db.query('SELECT id FROM users WHERE email = $1', [toEmail]);
    if (uRows.length === 0) fail(404, 'Email penerima tidak ditemukan');
    const toId = uRows[0].id;
    if (toId === fromId) fail(400, 'Tidak bisa transfer ke diri sendiri');
    const ref = `transfer:${Date.now()}:${fromId.slice(0, 8)}`;
    await spendPoints(db, fromId, points, 'transfer_out', { referenceId: `${ref}:out`, note });
    await db.query(
      `INSERT INTO loyalty_ledger (user_id, points, type, reference_id, note, expires_at)
       VALUES ($1, $2, 'transfer_in', $3, $4, $5)`,
      [toId, points, `${ref}:in`, note || `Transfer dari user`, expiryDate()]
    );
    await bumpLegacy(db, toId, points);
    if (owned) await db.query('COMMIT');
    return { points, toId };
  } catch (e) {
    if (owned) await db.query('ROLLBACK');
    throw e;
  } finally {
    if (owned) db.release();
  }
}

async function listLedger(db, userId, limit = 20) {
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const { rows } = await db.query(
    `SELECT id, points, type, reference_id, note, expires_at, created_at
     FROM loyalty_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, lim]
  );
  return rows;
}

module.exports = {
  pool,
  WELCOME_POINTS, REVIEW_POINTS, MIN_REDEEM, MAX_PCT, EXPIRY_MONTHS, EXPIRING_SOON_DAYS,
  usdToIdrRate, tierFor, discountUsdFor, conversion,
  validateRedeemQty, quoteRedeem,
  legacyPoints, getBalance, getExpiringSoon,
  addEarn, awardWelcome, spendPoints, transferPoints, listLedger,
};
