// tests/bookings-close.test.js
// Integration test AUTO-CLOSE booking + earn_booking (LOYALTY_DEFINITION.md §1).
// Booking confirmed + payment success + check-out lewat → completed + poin
// 1/Rp10.000. Tanpa Midtrans: booking+payment disisipkan via SQL.
// Port 5125 (jangan bentrok dengan money 5123 / reviews 5124).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
require('dotenv').config();
const { Pool } = require('pg');

const PORT = Number(process.env.TEST_PORT_CLOSE || 5125);
const BASE = `http://localhost:${PORT}`;
const HOTEL = 'a0000001-0000-0000-0000-000000000004'; // Puri Mas
const EMAIL = 'test_close_1@example.com';
const TOTAL = 357; // USD → 357*16000/10000 = 571 poin

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let server = null;
let token = null;
let userId = null;

async function api(method, path, tok, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

async function waitHealthy() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch { /* belum nyala */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server tidak nyala');
}

async function cleanupUser() {
  const ids = (await pool.query(`SELECT id FROM users WHERE email = $1`, [EMAIL])).rows;
  for (const { id } of ids) {
    await pool.query(`DELETE FROM payments WHERE user_id = $1`, [id]);
    await pool.query(`DELETE FROM bookings WHERE user_id = $1`, [id]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [id]); // cascade: ledger
  }
}

before(async () => {
  server = spawn('node', ['src/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  await waitHealthy();
  await cleanupUser();
  const reg = await api('POST', '/api/auth/register', null, {
    name: 'T Closer', email: EMAIL, password: 'secret123',
  });
  assert.equal(reg.status, 201);
  token = reg.json.data.token;
  userId = reg.json.data.user.id;
  // Trip lampau yang sudah dibayar sukses (check-out 2020).
  const b = await pool.query(
    `INSERT INTO bookings (booking_code, user_id, hotel_id, check_in, check_out, nights, guest_count, price_per_night, total_price, status)
     VALUES ($1,$2,$3,'2020-01-01','2020-01-03',2,2,145,$4,'confirmed') RETURNING id`,
    [`TST-CLOSE-${Date.now()}`, userId, HOTEL, TOTAL]
  );
  await pool.query(
    `INSERT INTO payments (transaction_id, booking_id, user_id, method, amount, status, paid_at)
     VALUES ($1,$2,$3,'qris',$4,'success',NOW())`,
    [`TST-TXN-${Date.now()}`, b.rows[0].id, userId, TOTAL]
  );
});

after(async () => {
  await cleanupUser();
  await pool.end();
  server.kill();
});

test('POST /close-past: 1 trip selesai +571 poin', async () => {
  const { status, json } = await api('POST', '/api/bookings/close-past', token);
  assert.equal(status, 200);
  assert.equal(json.data.closed.length, 1);
  assert.equal(json.data.closed[0].points, 571);
});

test('loyalty: 50 welcome + 571 booking = 621 (Gold)', async () => {
  const { status, json } = await api('GET', '/api/loyalty', token);
  assert.equal(status, 200);
  assert.equal(json.data.points, 621);
  assert.equal(json.data.tier, 'Gold');
});

test('idempotent: close lagi → kosong, poin tetap', async () => {
  const again = await api('POST', '/api/bookings/close-past', token);
  assert.equal(again.json.data.closed.length, 0);
  const loy = await api('GET', '/api/loyalty', token);
  assert.equal(loy.json.data.points, 621);
});

test('GET /my menampilkan status completed', async () => {
  const { status, json } = await api('GET', '/api/bookings/my', token);
  assert.equal(status, 200);
  assert.ok(json.data.some((b) => b.status === 'completed'));
});
