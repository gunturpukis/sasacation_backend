
// src/controllers/paymentsController.js
// Jawaban jujur atas mockup `travel_wallet_payments`: mockup itu menampilkan
// e-wallet bersaldo (Total Balance, Sasa Points) yang TIDAK ADA sistemnya di
// Sasacation — pembayaran real-time per-transaksi lewat Midtrans, bukan
// saldo tersimpan. Endpoint ini menyediakan RIWAYAT PEMBAYARAN NYATA
// (dari tabel `payments` yang sudah ada) sebagai pengganti yang jujur.
 
const pool = require('../config/db');
 
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
 
module.exports = { getPaymentHistory };
 