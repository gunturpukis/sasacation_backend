// tests/money.test.js
// Integration test ALUR UANG. Jalankan: npm test
//
// Membutuhkan: PostgreSQL dev (DATABASE_URL), akses jaringan ke Midtrans
// sandbox (untuk /pay & /topup — membuat transaksi Snap ASLI yang expire
// 15 menit, tanpa uang beneran), dan port TEST_PORT bebas.
// Data uji: 2 user temporer (test_money_*) yang dibuat + DIBERSIHKAN otomatis.
// Prinsip: tidak menyentuh data dev lain (tanggal booking 2028, kode unik).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { spawn } = require('child_process');
require('dotenv').config();
const { Pool } = require('pg');

const PORT = Number(process.env.TEST_PORT || 5123);
const BASE = `http://localhost:${PORT}`;
const MID_KEY = process.env.MIDTRANS_SERVER_KEY;
const RATE = Number(process.env.MIDTRANS_USD_TO_IDR_RATE || 16000);
const HOTEL = 'a0000001-0000-0000-0000-000000000004'; // Puri Mas (cleaning 20)
const U1 = 'test_money_1@example.com';
const U2 = 'test_money_2@example.com';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let server = null;
const jwt = (id) => require('jsonwebtoken').sign({ id }, process.env.JWT_SECRET, { expiresIn: '1h' });
let T1 = null;
let T2 = null;

async function api(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* PDF / non-JSON */ }
  return { status: res.status, json, text, headers: res.headers };
}

function sig(orderId, gross) {
  return crypto.createHash('sha512').update(`${orderId}200${gross}${MID_KEY}`).digest('hex');
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

// Notifikasi webhook dikirim async SETELAH respons HTTP (by design, agar
// tidak memperlambat Midtrans) — tunggu sampai muncul, bukan assert instan.
async function waitNotif(sql, params, timeoutMs = 8000) {
  const start = Date.now();
  for (;;) {
    const n = await pool.query(sql, params);
    if (n.rows.length > 0) return n.rows;
    if (Date.now() - start > timeoutMs) return [];
    await new Promise((r) => setTimeout(r, 200));
  }
}

before(async () => {
  server = spawn('node', ['src/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  await waitHealthy();
  await pool.query(`DELETE FROM users WHERE email IN ($1,$2)`, [U1, U2]);
  const { rows } = await pool.query(
    `INSERT INTO users (name,email,password,role,provider) VALUES ('T Money 1',$1,'x','user','email'),('T Money 2',$2,'x','user','email') RETURNING id,email`,
    [U1, U2]
  );
  T1 = jwt(rows.find((r) => r.email === U1).id);
  T2 = jwt(rows.find((r) => r.email === U2).id);
});

after(async () => {
  const ids = (await pool.query(`SELECT id FROM users WHERE email IN ($1,$2)`, [U1, U2])).rows.map((r) => r.id);
  for (const id of ids) {
    await pool.query(`DELETE FROM notifications WHERE user_id = $1`, [id]);
    await pool.query(`DELETE FROM payments WHERE user_id = $1`, [id]);
    await pool.query(`DELETE FROM bookings WHERE user_id = $1`, [id]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
  }
  await pool.end();
  server.kill();
});

// ─── Checkout ───
test('initiate: pricing ada cleaningFee + fx', async () => {
  const { status, json } = await api('POST', '/api/checkout/initiate', T1, {
    hotelId: HOTEL, checkIn: '2028-06-01', checkOut: '2028-06-03', guestCount: 2,
  });
  assert.equal(status, 200);
  // 145*2=290 + tax 32 + service 15 + cleaning 20 = 357
  assert.deepEqual(
    [json.data.pricing.subtotal, json.data.pricing.cleaningFee, json.data.pricing.total],
    [290, 20, 357]
  );
  assert.equal(json.data.pricing.fx.usd_to_idr_rate, RATE);
});

let TXN, BID, AMT;
test('pay: booking pending + snap tersimpan', async () => {
  const { status, json } = await api('POST', '/api/checkout/pay', T1, {
    hotelId: HOTEL, checkIn: '2028-06-01', checkOut: '2028-06-03', guestCount: 2, paymentMethod: 'qris',
  });
  assert.equal(status, 200);
  assert.equal(json.data.booking.status, 'pending');
  assert.ok(json.data.redirectUrl.startsWith('https://'));
  TXN = json.data.payment.transactionId; BID = json.data.booking.id; AMT = json.data.payment.amount;
  const { rows } = await pool.query('SELECT snap_token, redirect_url FROM payments WHERE transaction_id = $1', [TXN]);
  assert.ok(rows[0].snap_token && rows[0].redirect_url);
});

test('pay dobel tanggal sama: 409', async () => {
  const { status } = await api('POST', '/api/checkout/pay', T1, {
    hotelId: HOTEL, checkIn: '2028-06-01', checkOut: '2028-06-03', guestCount: 2, paymentMethod: 'qris',
  });
  assert.equal(status, 409);
});

test('resume: kembalikan URL Snap aktif', async () => {
  const { status, json } = await api('GET', `/api/checkout/resume/${BID}`, T1);
  assert.equal(status, 200);
  assert.equal(json.data.transactionId, TXN);
});

test('webhook settlement: confirmed + notif ber-action', async () => {
  const gross = Math.round(AMT * RATE);
  const { status } = await api('POST', '/api/checkout/webhook/midtrans', null, {
    order_id: TXN, status_code: '200', gross_amount: String(gross), signature_key: sig(TXN, gross),
    transaction_status: 'settlement', payment_type: 'qris',
  });
  assert.equal(status, 200);
  const b = await pool.query('SELECT status FROM bookings WHERE id = $1', [BID]);
  assert.equal(b.rows[0].status, 'confirmed');
  const n = await waitNotif(`SELECT data FROM notifications WHERE data->>'bookingId' = $1`, [BID]);
  assert.equal(n.length, 1);
  assert.equal(n[0].data.action.route, 'booking_detail');
});

test('resume setelah sukses: 404', async () => {
  const { status } = await api('GET', `/api/checkout/resume/${BID}`, T1);
  assert.equal(status, 404);
});

test('webhook failed: booking cancelled', async () => {
  const pay = await api('POST', '/api/checkout/pay', T1, {
    hotelId: HOTEL, checkIn: '2028-07-01', checkOut: '2028-07-03', guestCount: 1, paymentMethod: 'gopay',
  });
  const t2 = pay.json.data.payment.transactionId;
  const b2 = pay.json.data.booking.id;
  const gross = Math.round(pay.json.data.payment.amount * RATE);
  await api('POST', '/api/checkout/webhook/midtrans', null, {
    order_id: t2, status_code: '200', gross_amount: String(gross), signature_key: sig(t2, gross),
    transaction_status: 'expire',
  });
  const b = await pool.query('SELECT status FROM bookings WHERE id = $1', [b2]);
  assert.equal(b.rows[0].status, 'cancelled');
});

// ─── Wallet ───
let WORDER;
test('wallet topup + webhook: saldo, poin, notif', async () => {
  const top = await api('POST', '/api/wallet/topup', T1, { amount: 50 });
  assert.equal(top.status, 201);
  WORDER = top.json.data.transaction.reference_id;
  const gross = 50 * RATE;
  const { status } = await api('POST', '/api/wallet/webhook/midtrans', null, {
    order_id: WORDER, status_code: '200', gross_amount: String(gross), signature_key: sig(WORDER, gross),
    transaction_status: 'settlement',
  });
  assert.equal(status, 200);
  const w = await api('GET', '/api/wallet', T1);
  assert.deepEqual([w.json.data.balance, w.json.data.sasa_points], [50, 50]);
  const n = await waitNotif(`SELECT data FROM notifications WHERE data->>'referenceId' = $1`, [WORDER]);
  assert.equal(n[0].data.action.route, 'wallet');
});

test('wallet spend kurang: 400; cukup: sukses', async () => {
  const poor = await api('POST', '/api/wallet/spend', T1, { amount: 999 });
  assert.equal(poor.status, 400);
  const ok = await api('POST', '/api/wallet/spend', T1, { amount: 20, label: 'Test' });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.data.balance, 30);
});

test('wallet transfer dua arah tercatat', async () => {
  const { status, json } = await api('POST', '/api/wallet/transfer', T1, { email: U2, amount: 10 });
  assert.equal(status, 200);
  assert.equal(json.data.balance, 20);
  const recv = await api('GET', '/api/wallet', T2);
  assert.equal(recv.json.data.balance, 10);
  const tx = await api('GET', '/api/wallet/transactions?limit=5', T2);
  assert.equal(tx.json.data[0].type, 'transfer_in');
});

// ─── Refund guards (tanpa gerakkan uang) ───
test('refund: 403 user, 404 asing, 422 pending, 400 over', async () => {
  const r1 = await api('POST', `/api/payments/${TXN}/refund`, T1, {});
  assert.equal(r1.status, 403);
  const admin = jwt((await pool.query(`SELECT id FROM users WHERE email = 'admin@sasacation.com'`)).rows[0].id);
  const r2 = await api('POST', '/api/payments/TXN-NOPE/refund', admin, {});
  assert.equal(r2.status, 404);
  const pendPay = await api('POST', '/api/checkout/pay', T1, {
    hotelId: HOTEL, checkIn: '2028-10-01', checkOut: '2028-10-02', guestCount: 1, paymentMethod: 'qris',
  });
  assert.equal(pendPay.status, 200);
  const r3 = await api('POST', `/api/payments/${pendPay.json.data.payment.transactionId}/refund`, admin, {});
  assert.equal(r3.status, 422);
  const r4 = await api('POST', `/api/payments/${TXN}/refund`, admin, { amount: 999999 });
  assert.equal(r4.status, 400);
});

// ─── Invoice ───
test('invoice: PDF valid; pending 422; asing 404', async () => {
  const res = await fetch(`${BASE}/api/payments/${TXN}/invoice`, {
    headers: { Authorization: `Bearer ${T1}` },
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /pdf/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');

  const pendPay = await api('POST', '/api/checkout/pay', T1, {
    hotelId: HOTEL, checkIn: '2028-09-01', checkOut: '2028-09-02', guestCount: 1, paymentMethod: 'qris',
  });
  assert.equal(pendPay.status, 200);
  const r2 = await api('GET', `/api/payments/${pendPay.json.data.payment.transactionId}/invoice`, T1);
  assert.equal(r2.status, 422);
  const r3 = await api('GET', '/api/payments/TXN-NOPE/invoice', T1);
  assert.equal(r3.status, 404);
});
