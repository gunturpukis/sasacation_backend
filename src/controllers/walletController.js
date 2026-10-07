// src/controllers/walletController.js
// P2 (FLUTTER_P3_CONTRACTS.md): Travel Wallet.
//
// Kontrak:
//   - GET  /api/wallet              → { balance, currency, sasa_points }
//   - POST /api/wallet/topup        → body { amount, paymentMethod? }, via Midtrans Snap
//   - POST /api/wallet/webhook/midtrans (dipanggil server Midtrans, tanpa JWT)
//   - GET  /api/wallet/transactions → riwayat khusus wallet (terpisah dari `payments`)
//   - POST /api/wallet/spend        → pakai saldo (kurangi + catat transaksi)
//
// Konvensi uang: DB menyimpan sen (balance_cents BIGINT) supaya tidak ada
// error pembulatan float. API menerima/mengembalikan dolar (balance = sen/100).
// Midtrans hanya terima IDR integer → konversi pakai rate yang sama dengan
// checkout (MIDTRANS_USD_TO_IDR_RATE).
//
// Poin: 1 Sasa point per $1 top-up yang sukses (floor dari nominal USD).

const pool = require('../config/db');
const midtransService = require('../services/midtransService');
const { notifyUser, buildAction } = require('../services/notificationService');

const USD_TO_IDR_RATE = Number(process.env.MIDTRANS_USD_TO_IDR_RATE || 16000);
const MIN_TOPUP_USD = 1;
const MAX_TOPUP_USD = 100000;
const POINTS_PER_USD = 1;

// Pastikan baris wallet + loyalty ada (auto-create saldo 0 untuk user baru).
// `db` bisa pool maupun client transaksi — keduanya punya .query().
async function ensureRows(db, userId) {
  await db.query(
    `INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
  await db.query(
    `INSERT INTO loyalty_points (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

function toWalletJson(walletRow, points) {
  const cents = Number(walletRow.balance_cents);
  return {
    balance: cents / 100,
    balance_cents: cents,
    currency: walletRow.currency || 'USD',
    sasa_points: Number(points),
  };
}

function toTxJson(row) {
  const cents = Number(row.amount_cents);
  return {
    id: row.id,
    type: row.type,
    amount: cents / 100,
    amount_cents: cents,
    balance_after: row.balance_after_cents === null ? null : Number(row.balance_after_cents) / 100,
    balance_after_cents: row.balance_after_cents === null ? null : Number(row.balance_after_cents),
    label: row.label,
    reference_id: row.reference_id,
    status: row.status,
    created_at: row.created_at,
  };
}

// GET /api/wallet
const getWallet = async (req, res) => {
  try {
    await ensureRows(pool, req.user.id);
    const [{ rows: wRows }, { rows: pRows }] = await Promise.all([
      pool.query('SELECT * FROM wallets WHERE user_id = $1', [req.user.id]),
      pool.query('SELECT points FROM loyalty_points WHERE user_id = $1', [req.user.id]),
    ]);
    res.json({ success: true, data: toWalletJson(wRows[0], pRows[0]?.points ?? 0) });
  } catch (e) {
    console.error('[getWallet] error:', e.message);
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// GET /api/wallet/transactions?page=&limit=
const getTransactions = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(
        `SELECT * FROM wallet_transactions WHERE user_id = $1
         ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [req.user.id, limit, offset]
      ),
      pool.query(`SELECT COUNT(*) FROM wallet_transactions WHERE user_id = $1`, [req.user.id]),
    ]);

    const total = Number(countRows[0].count);
    res.json({
      success: true,
      data: rows.map(toTxJson),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (e) {
    console.error('[getTransactions] error:', e.message);
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// POST /api/wallet/topup  body: { amount, paymentMethod? }
// `amount` dalam USD (mis. 50 = $50). Buat transaksi pending + Snap Midtrans,
// saldo baru bertambah lewat webhook (bukan di sini).
const topup = async (req, res) => {
  const client = await pool.connect();
  try {
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount < MIN_TOPUP_USD || amount > MAX_TOPUP_USD) {
      return res.status(400).json({
        success: false,
        message: `amount wajib angka antara ${MIN_TOPUP_USD} dan ${MAX_TOPUP_USD} (USD)`,
      });
    }
    const { paymentMethod } = req.body;

    const amountCents = Math.round(amount * 100);
    const grossAmountIdr = Math.round(amount * USD_TO_IDR_RATE);
    const orderId = `WALLET-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    await client.query('BEGIN');
    await ensureRows(client, req.user.id);

    const { rows } = await client.query(
      `INSERT INTO wallet_transactions
         (user_id, type, amount_cents, label, reference_id, status, metadata)
       VALUES ($1,'topup',$2,$3,$4,'pending',$5)
       RETURNING *`,
      [
        req.user.id,
        amountCents,
        'Top up via Midtrans',
        orderId,
        JSON.stringify({ amount_usd: amount, gross_amount_idr: grossAmountIdr }),
      ]
    );

    // Buat transaksi Snap SEBELUM commit — kalau Midtrans error, insert
    // pending di atas ikut rollback supaya tidak ada transaksi yatim.
    let snapResult;
    try {
      snapResult = await midtransService.createTransaction({
        orderId,
        grossAmount: grossAmountIdr,
        customer: { name: req.user.name, email: req.user.email },
        itemName: `Sasacation wallet top-up $${amount}`,
        enabledPayments: paymentMethod
          ? midtransService.mapToEnabledPayments(paymentMethod)
          : undefined,
        // P4 vault: pre-fill kartu tersimpan + toggle save card (kartu kredit).
        userId: req.user.id,
        ...(paymentMethod === 'credit_card' && req.body.saveCard === true
          ? { creditCard: { secure: true, save_card: true } }
          : {}),
      });
    } catch (midtransErr) {
      await client.query('ROLLBACK');
      console.error('[wallet topup] Midtrans error:', midtransErr.message);
      return res.status(502).json({
        success: false,
        message: 'Gagal membuat transaksi Midtrans, coba lagi nanti',
        error: midtransErr.message,
      });
    }

    await client.query('COMMIT');
    res.status(201).json({
      success: true,
      message: 'Silakan selesaikan pembayaran top-up',
      data: {
        transaction: toTxJson(rows[0]),
        snapToken: snapResult.token,
        redirectUrl: snapResult.redirect_url,
      },
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[wallet topup] error:', e.message);
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  } finally {
    client.release();
  }
};

// POST /api/wallet/webhook/midtrans
// Dipanggil SERVER Midtrans (tanpa JWT). Keamanan = verifikasi signature.
// Idempotent: webhook retry untuk order yang sudah final diabaikan.
const handleWalletWebhook = async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      order_id: orderId,
      status_code: statusCode,
      gross_amount: grossAmount,
      signature_key: signatureKey,
      transaction_status: transactionStatus,
      fraud_status: fraudStatus,
    } = req.body || {};

    if (!orderId) return res.status(200).json({ success: false, message: 'order_id kosong' });

    const isValid = midtransService.verifySignature({ orderId, statusCode, grossAmount, signatureKey });
    if (!isValid) {
      console.warn(`[wallet webhook] signature tidak valid untuk order_id=${orderId}`);
      return res.status(200).json({ success: false, message: 'Invalid signature' });
    }

    const newStatus = midtransService.mapTransactionStatus(transactionStatus, fraudStatus);

    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM wallet_transactions WHERE reference_id = $1 FOR UPDATE`,
      [orderId]
    );
    if (rows.length === 0) {
      // Bukan top-up wallet (kemungkinan payment booking) — bukan urusan kita.
      await client.query('ROLLBACK');
      return res.status(200).json({ success: false, message: 'Transaction not found' });
    }
    const tx = rows[0];
    if (tx.status === newStatus || (tx.status === 'success' && newStatus === 'success')) {
      await client.query('ROLLBACK');
      console.log(`[wallet webhook] order_id=${orderId} sudah ${tx.status} — skip (retry)`);
      return res.status(200).json({ success: true, message: 'Already processed' });
    }

    if (newStatus === 'success') {
      await ensureRows(client, tx.user_id);
      const { rows: wRows } = await client.query(
        `SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE`,
        [tx.user_id]
      );
      const newBalance = Number(wRows[0].balance_cents) + Number(tx.amount_cents);

      await client.query(
        `UPDATE wallets SET balance_cents = $1, updated_at = NOW() WHERE user_id = $2`,
        [newBalance, tx.user_id]
      );
      await client.query(
        `UPDATE wallet_transactions
         SET status = 'success', balance_after_cents = $1, metadata = metadata || $2
         WHERE id = $3`,
        [newBalance, JSON.stringify(req.body), tx.id]
      );

      // Poin loyalitas: 1 poin per $1 (floor). Dual-write: kolom legasi
      // (kompatibilitas + money.test) + ledger (sumber kebenaran baru).
      // Idempotent via reference topup:<orderId> — retry webhook aman.
      const earned = Math.floor(Number(tx.amount_cents) / 100) * POINTS_PER_USD;
      if (earned > 0) {
        await client.query(
          `UPDATE loyalty_points SET points = points + $1, updated_at = NOW() WHERE user_id = $2`,
          [earned, tx.user_id]
        );
        try {
          await client.query(
            `INSERT INTO loyalty_ledger (user_id, points, type, reference_id, note, expires_at)
             VALUES ($1, $2, 'earn_topup', $3, $4, NOW() + INTERVAL '12 months')
             ON CONFLICT (reference_id) DO NOTHING`,
            [tx.user_id, earned, `topup:${orderId}`, `Top-up wallet $${Number(tx.amount_cents) / 100}`]
          );
        } catch (e) {
          if (e.code !== '42P01') throw e; // tabel belum dimigrasi → legasi saja
        }
      }
      console.log(`[wallet webhook] order_id=${orderId} -> success (+${tx.amount_cents}c, +${earned}pts)`);
    } else if (newStatus === 'failed') {
      await client.query(
        `UPDATE wallet_transactions SET status = 'failed', metadata = metadata || $1 WHERE id = $2`,
        [JSON.stringify(req.body), tx.id]
      );
      console.log(`[wallet webhook] order_id=${orderId} -> failed`);
    } else {
      // Masih pending (challenge, dsb.) — simpan payload terakhir saja.
      await client.query(
        `UPDATE wallet_transactions SET metadata = metadata || $1 WHERE id = $2`,
        [JSON.stringify(req.body), tx.id]
      );
      console.log(`[wallet webhook] order_id=${orderId} -> pending`);
    }

    await client.query('COMMIT');

    // P6: notifikasi top-up sukses dikirim SETELAH response ke Midtrans (di luar
    // transaksi DB) — pola sama seperti checkout. `creditedTx` hanya diisi bila
    // transisi ini yang mengkreditkan saldo (bukan webhook retry).
    const creditedTx = newStatus === 'success' && tx.status !== 'success' ? tx : null;
    res.status(200).json({ success: true });

    if (creditedTx) {
      notifyWalletTopup(creditedTx).catch((err) =>
        console.error('[wallet webhook] gagal kirim notifikasi:', err.message)
      );
    }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[wallet webhook] error:', e.message);
    res.status(200).json({ success: false, message: 'Internal error' });
  } finally {
    client.release();
  }
};

// Notifikasi top-up sukses: riwayat SELALU disimpan (user tanpa FCM token
// tetap lihat di Notifications screen), push hanya bila ada token.
// P6: data membawa action "Lihat Wallet" untuk tombol Figma.
async function notifyWalletTopup(tx) {
  const { rows } = await pool.query('SELECT fcm_token FROM users WHERE id = $1', [tx.user_id]);
  const amountUsd = Number(tx.amount_cents) / 100;
  await notifyUser(
    tx.user_id,
    rows[0]?.fcm_token || null,
    {
      title: 'Top-up Berhasil! 🎉',
      body: `Saldo wallet bertambah $${amountUsd}. Selamat liburan!`,
    },
    {
      type: 'wallet_topup',
      referenceId: tx.reference_id,
      amount: amountUsd,
      action: buildAction('Lihat Wallet', 'wallet'),
    }
  );
}

// POST /api/wallet/spend  body: { amount, label? }
// Kurangi saldo (mis. bayar booking pakai wallet). Gagal 400 bila kurang.
const spend = async (req, res) => {
  const client = await pool.connect();
  try {
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_TOPUP_USD) {
      return res.status(400).json({ success: false, message: 'amount wajib angka positif (USD)' });
    }
    const amountCents = Math.round(amount * 100);
    const label = req.body.label || 'Wallet payment';

    await client.query('BEGIN');
    await ensureRows(client, req.user.id);
    const { rows: wRows } = await client.query(
      `SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE`,
      [req.user.id]
    );
    const balance = Number(wRows[0].balance_cents);
    if (balance < amountCents) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Saldo wallet tidak cukup' });
    }

    const newBalance = balance - amountCents;
    await client.query(
      `UPDATE wallets SET balance_cents = $1, updated_at = NOW() WHERE user_id = $2`,
      [newBalance, req.user.id]
    );
    const { rows } = await client.query(
      `INSERT INTO wallet_transactions
         (user_id, type, amount_cents, balance_after_cents, label, status)
       VALUES ($1,'spend',$2,$3,$4,'success')
       RETURNING *`,
      [req.user.id, -amountCents, newBalance, label]
    );
    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Pembayaran wallet berhasil',
      data: { transaction: toTxJson(rows[0]), balance: newBalance / 100, currency: 'USD' },
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[wallet spend] error:', e.message);
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  } finally {
    client.release();
  }
};

// POST /api/wallet/transfer  body: { email, amount, note? }
// A6 (tombol "Transfer" Figma): pindahkan saldo ke user lain (cari via
// email). Atomik: kedua dompet di-lock berurutan user_id (anti-deadlock),
// dua baris transaksi (transfer_out pengirim, transfer_in penerima).
const transfer = async (req, res) => {
  const client = await pool.connect();
  try {
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_TOPUP_USD) {
      return res.status(400).json({ success: false, message: 'amount wajib angka positif (USD)' });
    }
    if (!req.body.email)
      return res.status(400).json({ success: false, message: 'email penerima wajib diisi' });

    const { rows: users } = await client.query(
      'SELECT id, name FROM users WHERE email = $1',
      [String(req.body.email).toLowerCase()]
    );
    if (users.length === 0)
      return res.status(404).json({ success: false, message: 'Penerima tidak ditemukan' });
    if (users[0].id === req.user.id)
      return res.status(400).json({ success: false, message: 'Tidak bisa transfer ke diri sendiri' });

    const amountCents = Math.round(amount * 100);
    const note = req.body.note ? String(req.body.note).slice(0, 100) : '';

    await client.query('BEGIN');
    await ensureRows(client, req.user.id);
    await ensureRows(client, users[0].id);

    // Lock deterministik (urutan user_id) supaya dua transfer berlawanan arah
    // bersamaan tidak deadlock.
    const [first, second] = [req.user.id, users[0].id].sort();
    const { rows: locked } = await client.query(
      `SELECT user_id, balance_cents FROM wallets WHERE user_id IN ($1,$2) FOR UPDATE`,
      [first, second]
    );
    const bal = Object.fromEntries(locked.map((r) => [r.user_id, Number(r.balance_cents)]));
    if ((bal[req.user.id] ?? 0) < amountCents) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Saldo wallet tidak cukup' });
    }

    const senderAfter = bal[req.user.id] - amountCents;
    const receiverAfter = (bal[users[0].id] ?? 0) + amountCents;
    await client.query(`UPDATE wallets SET balance_cents = $1, updated_at = NOW() WHERE user_id = $2`, [senderAfter, req.user.id]);
    await client.query(`UPDATE wallets SET balance_cents = $1, updated_at = NOW() WHERE user_id = $2`, [receiverAfter, users[0].id]);

    const senderLabel = `Transfer to ${users[0].name}${note ? ` — ${note}` : ''}`;
    const receiverLabel = `Transfer from ${req.user.name}${note ? ` — ${note}` : ''}`;
    const { rows } = await client.query(
      `INSERT INTO wallet_transactions (user_id, type, amount_cents, balance_after_cents, label, status)
       VALUES ($1,'transfer_out',$2,$3,$4,'success') RETURNING *`,
      [req.user.id, -amountCents, senderAfter, senderLabel]
    );
    await client.query(
      `INSERT INTO wallet_transactions (user_id, type, amount_cents, balance_after_cents, label, status)
       VALUES ($1,'transfer_in',$2,$3,$4,'success')`,
      [users[0].id, amountCents, receiverAfter, receiverLabel]
    );
    await client.query('COMMIT');

    res.json({
      success: true,
      message: `Transfer $${amount} ke ${users[0].name} berhasil`,
      data: { transaction: toTxJson(rows[0]), balance: senderAfter / 100, currency: 'USD' },
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[wallet transfer] error:', e.message);
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  } finally {
    client.release();
  }
};

module.exports = { getWallet, getTransactions, topup, handleWalletWebhook, spend, transfer };
