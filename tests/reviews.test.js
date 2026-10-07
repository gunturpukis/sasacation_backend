// tests/reviews.test.js
// Integration test ULASAN + earn_review. Jalankan: npm test / node --test tests/reviews.test.js
//
// Membutuhkan: PostgreSQL dev (DATABASE_URL) + port TEST_PORT_REVIEWS bebas.
// TIDAK butuh Midtrans/Ollama. Data uji: 1 user temporer (test_rev_*) yang
// dibuat via API register (sekaligus menguji welcome bonus) + DIBERSIHKAN
// otomatis beserta review & ledger-nya.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
require('dotenv').config();
const { Pool } = require('pg');

const PORT = Number(process.env.TEST_PORT_REVIEWS || 5124);
const BASE = `http://localhost:${PORT}`;
const HOTEL = 'a0000001-0000-0000-0000-000000000004'; // Puri Mas
const EMAIL = 'test_rev_1@example.com';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let server = null;
let token = null;

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

before(async () => {
  server = spawn('node', ['src/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  await waitHealthy();
  const ids = (await pool.query(`SELECT id FROM users WHERE email = $1`, [EMAIL])).rows;
  for (const { id } of ids) {
    await pool.query(`DELETE FROM reviews WHERE user_id = $1`, [id]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
  }
  const reg = await api('POST', '/api/auth/register', null, {
    name: 'T Reviewer', email: EMAIL, password: 'secret123',
  });
  assert.equal(reg.status, 201);
  token = reg.json.data.token;
});

after(async () => {
  const ids = (await pool.query(`SELECT id FROM users WHERE email = $1`, [EMAIL])).rows;
  for (const { id } of ids) {
    await pool.query(`DELETE FROM reviews WHERE user_id = $1`, [id]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [id]); // cascade: ledger
  }
  await pool.end();
  server.kill();
});

test('register dapat welcome bonus 50', async () => {
  const { status, json } = await api('GET', '/api/loyalty', token);
  assert.equal(status, 200);
  assert.equal(json.data.points, 50);
});

test('POST review pertama: 201 + earned 25', async () => {
  const { status, json } = await api('POST', `/api/hotels/${HOTEL}/reviews`, token, {
    rating: 5, text: 'Ulasan integrasi — kamar bersih dan staff ramah.', stayed: 'Jun 2028',
  });
  assert.equal(status, 201);
  assert.equal(json.data.rating, 5);
  assert.equal(json.data.earned_points, 25);
  assert.equal(json.data.user_name, 'T Reviewer');
});

test('loyalty kini 75 (50 welcome + 25 review)', async () => {
  const { status, json } = await api('GET', '/api/loyalty', token);
  assert.equal(status, 200);
  assert.equal(json.data.points, 75);
});

test('kirim lagi = update (200, tanpa poin ganda)', async () => {
  const { status, json } = await api('POST', `/api/hotels/${HOTEL}/reviews`, token, {
    rating: 4, text: 'Ulasan integrasi — diubah, tetap bagus.',
  });
  assert.equal(status, 200);
  assert.equal(json.data.rating, 4);
  assert.equal(json.data.earned_points, 0);
  const loy = await api('GET', '/api/loyalty', token);
  assert.equal(loy.json.data.points, 75);
});

test('GET reviews memuat ulasan baru', async () => {
  const { status, json } = await api('GET', `/api/hotels/${HOTEL}/reviews?limit=50`, null);
  assert.equal(status, 200);
  assert.ok(json.data.some((r) => r.user_name === 'T Reviewer' && r.text.includes('diubah')));
});

test('validasi: rating ngawur 400, teks kosong 400, tanpa token 401, hotel asing 404', async () => {
  const bad1 = await api('POST', `/api/hotels/${HOTEL}/reviews`, token, { rating: 9, text: 'x' });
  assert.equal(bad1.status, 400);
  const bad2 = await api('POST', `/api/hotels/${HOTEL}/reviews`, token, { rating: 5, text: '   ' });
  assert.equal(bad2.status, 400);
  const noAuth = await api('POST', `/api/hotels/${HOTEL}/reviews`, null, { rating: 5, text: 'x' });
  assert.equal(noAuth.status, 401);
  const noHotel = await api('POST', '/api/hotels/00000000-0000-0000-0000-000000000000/reviews', token, {
    rating: 5, text: 'x',
  });
  assert.equal(noHotel.status, 404);
});
