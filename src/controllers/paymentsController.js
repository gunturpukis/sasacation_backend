
// src/controllers/paymentsController.js
// Jawaban jujur atas mockup `travel_wallet_payments`: mockup itu menampilkan
// e-wallet bersaldo (Total Balance, Sasa Points) yang TIDAK ADA sistemnya di
// Sasacation — pembayaran real-time per-transaksi lewat Midtrans, bukan
// saldo tersimpan. Endpoint ini menyediakan RIWAYAT PEMBAYARAN NYATA
// (dari tabel `payments` yang sudah ada) sebagai pengganti yang jujur.
 
const pool = require('../config/db');
const { buildInvoicePdf } = require('../services/invoiceService');
const midtransService = require('../services/midtransService');
const { notifyUser, buildAction } = require('../services/notificationService');

const USD_TO_IDR_RATE = Number(process.env.MIDTRANS_USD_TO_IDR_RATE || 16000);
 
// GET /api/payments — riwayat pembayaran user, terurut terbaru dulu
const getPaymentHistory = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.transaction_id, p.method, p.amount, p.currency, p.status, p.paid_at,
              b.booking_code, h.name AS hotel_name, h.location AS hotel_location, h.image AS hotel_image
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       JOIN hotels h ON h.id = b.hotel_id
       WHERE p.user_id = $1
       ORDER BY p.paid_at DESC`,
      [req.user.id]
    );
 
    // Total dibelanjakan — dihitung dari transaksi SUKSES saja, angka ini
    // REAL (jumlah dari payments.amount), bukan "saldo" seperti di mockup.
    const totalSpent = rows
      .filter(r => r.status === 'success')
      .reduce((sum, r) => sum + parseFloat(r.amount), 0);
 
    res.json({ success: true, data: rows, totalSpent });
  } catch (e) {
    console.error('Get payment history error:', e);
    res.status(500).json({ success: false, message: 'Gagal mengambil riwayat pembayaran' });
  }
};

// GET /api/payments/:transactionId/invoice — unduh invoice PDF.
// Hanya untuk payment sukses milik sendiri (atau admin). Derivasi penuh dari
// baris DB (tidak ada angka karangan): service fee dihitung residu
// (total - subtotal - tax - cleaning) supaya baris SELALU pas dijumlahkan,
// termasuk booking lama sebelum kolom cleaning_fee ada.
const getInvoice = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.transaction_id, p.method, p.amount, p.status, p.paid_at,
              p.tax_amount, p.service_fee AS pay_service_fee, p.cleaning_fee AS pay_cleaning_fee,
              b.booking_code, b.check_in, b.check_out, b.nights, b.guest_count,
              b.price_per_night, b.total_price, b.user_id,
              h.name AS hotel_name, h.location AS hotel_location,
              h.cleaning_fee AS hotel_cleaning_fee,
              u.name AS customer_name, u.email AS customer_email,
              s.language AS lang
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       JOIN hotels h ON h.id = b.hotel_id
       JOIN users u ON u.id = p.user_id
       LEFT JOIN user_settings s ON s.user_id = p.user_id
       WHERE p.transaction_id = $1`,
      [req.params.transactionId]
    );
    if (rows.length === 0)
      return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan' });

    const r = rows[0];
    if (r.user_id !== req.user.id && req.user.role !== 'admin')
      return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan' });
    if (r.status !== 'success')
      return res.status(422).json({ success: false, message: 'Invoice hanya tersedia untuk pembayaran sukses' });

    const pricePerNight = Number(r.price_per_night);
    const nights = Number(r.nights);
    const subtotal = pricePerNight * nights;
    const total = Number(r.amount);
    // Snapshot bila ada (booking baru); fallback untuk baris lama:
    // cleaning 0 + service residu (rumus era lama: total = subtotal + tax + 15).
    const hasSnapshot = r.tax_amount !== null && r.pay_service_fee !== null && r.pay_cleaning_fee !== null;
    const tax = hasSnapshot ? Number(r.tax_amount) : Math.round(subtotal * 0.11);
    const cleaningFee = hasSnapshot ? Number(r.pay_cleaning_fee) : 0;
    const serviceFee = hasSnapshot ? Number(r.pay_service_fee) : total - subtotal - tax;

    const pdf = await buildInvoicePdf({
      invoiceNo: `INV/${new Date(r.paid_at).getFullYear()}/${r.transaction_id}`,
      transactionId: r.transaction_id,
      bookingCode: r.booking_code,
      paidAt: r.paid_at,
      customerName: r.customer_name,
      customerEmail: r.customer_email,
      hotelName: r.hotel_name,
      hotelLocation: r.hotel_location,
      checkIn: r.check_in,
      checkOut: r.check_out,
      nights,
      guestCount: Number(r.guest_count),
      pricePerNight,
      subtotal, tax, serviceFee, cleaningFee, total,
      method: r.method,
      lang: r.lang === 'id' ? 'id' : 'en',
    });

    const filename = `INV-${String(r.transaction_id).replace(/[^A-Za-z0-9-]/g, '_')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (e) {
    console.error('Get invoice error:', e);
    res.status(500).json({ success: false, message: 'Gagal membuat invoice' });
  }
};

// POST /api/payments/:transactionId/refund — ADMIN only.
// Body opsional: { amount (USD, default full), reason }.
// Full refund → booking ikut 'cancelled'; parsial → booking tetap.
// Gagal di gateway = 502 TANPA perubahan DB (uang tidak jelas statusnya
// jangan dicatat refund).
const refundPayment = async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await pool.query('SELECT * FROM payments WHERE transaction_id = $1', [req.params.transactionId]);
    if (rows.length === 0)
      return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan' });
    const payment = rows[0];
    if (payment.status !== 'success')
      return res.status(422).json({ success: false, message: 'Hanya pembayaran sukses yang bisa di-refund' });

    const paidUsd = Number(payment.amount);
    const amountUsd = req.body.amount === undefined ? paidUsd : Number(req.body.amount);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0 || amountUsd > paidUsd) {
      return res.status(400).json({ success: false, message: `amount harus 0 < x <= ${paidUsd} (USD)` });
    }
    const isFull = amountUsd === paidUsd;

    let gatewayResult;
    try {
      gatewayResult = await midtransService.refundTransaction(
        payment.transaction_id,
        amountUsd * USD_TO_IDR_RATE,
        req.body.reason
      );
    } catch (gwErr) {
      console.error('[refund] gateway gagal:', gwErr.message);
      return res.status(502).json({
        success: false,
        message: 'Refund di Midtrans gagal — DB tidak diubah, coba lagi nanti',
        error: gwErr.message,
      });
    }

    await client.query('BEGIN');
    const { rows: updated } = await client.query(
      `UPDATE payments SET status = 'refunded', gateway_response = $1 WHERE id = $2 RETURNING *`,
      [JSON.stringify({ refund: gatewayResult, amount_usd: amountUsd, reason: req.body.reason || null }), payment.id]
    );
    if (isFull) {
      await client.query(
        `UPDATE bookings SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND status IN ('pending','confirmed')`,
        [payment.booking_id]
      );
    }
    await client.query('COMMIT');

    res.json({
      success: true,
      message: isFull ? 'Refund penuh berhasil — booking dibatalkan' : `Refund parsial $${amountUsd} berhasil`,
      data: { ...updated[0], refunded_amount_usd: amountUsd, booking_cancelled: isFull },
    });

    // Notifikasi di luar transaksi (gagal kirim tidak menggagalkan refund).
    (async () => {
      try {
        const { rows: uRows } = await pool.query('SELECT fcm_token FROM users WHERE id = $1', [payment.user_id]);
        await notifyUser(
          payment.user_id,
          uRows[0]?.fcm_token || null,
          {
            title: 'Refund Berhasil 💸',
            body: isFull
              ? `Pembayaran ${payment.transaction_id} dikembalikan penuh.`
              : `Sebesar $${amountUsd} dari ${payment.transaction_id} dikembalikan.`,
          },
          {
            type: 'payment_refunded',
            transactionId: payment.transaction_id,
            amount: amountUsd,
            action: buildAction('Lihat Booking', 'booking_detail', { bookingId: payment.booking_id }),
          }
        );
      } catch (e) {
        console.error('[refund] notifikasi gagal (diabaikan):', e.message);
      }
    })();
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[refund] error:', e.message);
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  } finally {
    client.release();
  }
};
 
module.exports = { getPaymentHistory, getInvoice, refundPayment };
 