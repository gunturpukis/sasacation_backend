const pool = require('../config/db');
const midtransService = require('../services/midtransService');
 
const PAYMENT_METHODS = [
  { id: 'credit_card',   label: 'Kartu Kredit / Debit', icon: 'credit_card',           available: true },
  { id: 'bank_transfer', label: 'Transfer Bank',         icon: 'account_balance',        available: true },
  { id: 'gopay',         label: 'GoPay',                 icon: 'account_balance_wallet', available: true },
  { id: 'ovo',           label: 'OVO',                   icon: 'account_balance_wallet', available: true },
  { id: 'dana',          label: 'DANA',                  icon: 'account_balance_wallet', available: true },
  { id: 'qris',          label: 'QRIS',                  icon: 'qr_code_scanner',        available: true },
];
 
// Midtrans (region Indonesia) hanya menerima gross_amount dalam IDR — tidak
// ada parameter currency di Snap API standar. Harga Sasacation ditampilkan
// dalam USD, jadi perlu dikonversi SAAT membuat transaksi ke Midtrans saja
// (tampilan USD di app/DB tidak berubah). Rate di-env-kan supaya gampang
// disesuaikan, TAPI ini tetap simplifikasi — untuk production sebaiknya
// harga disimpan native dalam IDR, karena kurs realtime butuh third-party
// rate provider yang juga perlu di-refresh berkala.
const USD_TO_IDR_RATE = Number(process.env.MIDTRANS_USD_TO_IDR_RATE || 16000);
 
// GET /api/checkout/methods
const getPaymentMethods = (_req, res) => {
  res.json({ success: true, data: PAYMENT_METHODS });
};
 
// POST /api/checkout/initiate
// Hitung harga (subtotal + pajak + biaya layanan), belum simpan ke DB
const initiateCheckout = async (req, res) => {
  try {
    const { hotelId, checkIn, checkOut, guestCount, notes } = req.body;
    if (!hotelId || !checkIn || !checkOut || !guestCount)
      return res.status(400).json({ success: false, message: 'hotelId, checkIn, checkOut, guestCount wajib diisi' });
 
    const { rows } = await pool.query('SELECT * FROM hotels WHERE id = $1 AND available = true', [hotelId]);
    if (rows.length === 0)
      return res.status(404).json({ success: false, message: 'Hotel tidak ditemukan' });
    const hotel = rows[0];
 
    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);
    const nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
    if (nights <= 0)
      return res.status(400).json({ success: false, message: 'Tanggal checkout harus setelah checkin' });
 
    const pricePerNight = Number(hotel.price);
    const subtotal = pricePerNight * nights;
    const taxRate = 0.11;
    const serviceFee = 15;
    const tax = Math.round(subtotal * taxRate);
    const total = subtotal + tax + serviceFee;
 
    res.json({
      success: true,
      data: {
        hotel: {
          id: hotel.id, name: hotel.name, location: hotel.location,
          image: hotel.image, rating: hotel.rating, amenities: hotel.amenities,
        },
        checkIn: checkInDate.toISOString(),
        checkOut: checkOutDate.toISOString(),
        nights,
        guestCount: Number(guestCount),
        notes: notes || '',
        pricing: { pricePerNight, subtotal, tax, taxRate: taxRate * 100, serviceFee, total, currency: 'USD' },
        paymentMethods: PAYMENT_METHODS,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};
 
// POST /api/checkout/pay
// FIX UTAMA: sebelumnya endpoint ini langsung set payment.status = 'success'
// tanpa pernah menyentuh payment gateway — sekarang booking + payment dibuat
// dalam status 'pending', lalu transaksi Snap Midtrans dibuat dan snapToken
// dikembalikan ke client untuk membuka halaman pembayaran asli. Status baru
// benar-benar jadi 'success'/'failed' lewat webhook (lihat handleWebhook).
const processPayment = async (req, res) => {
  const client = await pool.connect();
  try {
    const { hotelId, checkIn, checkOut, guestCount, notes, paymentMethod } = req.body;
    if (!hotelId || !checkIn || !checkOut || !guestCount || !paymentMethod)
      return res.status(400).json({ success: false, message: 'Data pembayaran tidak lengkap' });
 
    const { rows: hotelRows } = await client.query('SELECT * FROM hotels WHERE id = $1', [hotelId]);
    if (hotelRows.length === 0)
      return res.status(404).json({ success: false, message: 'Hotel tidak ditemukan' });
    const hotel = hotelRows[0];
 
    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);
    const nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
    const pricePerNight = Number(hotel.price);
    const subtotal = pricePerNight * nights;
    const total = subtotal + Math.round(subtotal * 0.11) + 15;
 
    const bookingCode = 'SAC-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const transactionId = 'TXN-' + Date.now();
 
    await client.query('BEGIN');
 
    // 1. Buat booking (tetap 'confirmed' — kalau pembayaran gagal/expired,
    //    webhook yang akan membatalkannya, lihat handleWebhook di bawah)
    const bookingResult = await client.query(`
      INSERT INTO bookings (booking_code, user_id, hotel_id, check_in, check_out, nights, guest_count, price_per_night, total_price, notes, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'confirmed')
      RETURNING *
    `, [bookingCode, req.user.id, hotelId, checkInDate, checkOutDate, nights, guestCount, pricePerNight, total, notes || '']);
    const booking = bookingResult.rows[0];
 
    // 2. Buat payment dengan status 'pending' — BUKAN 'success' lagi
    const paymentResult = await client.query(`
      INSERT INTO payments (transaction_id, booking_id, user_id, method, amount, currency, status)
      VALUES ($1,$2,$3,$4,$5,'USD','pending')
      RETURNING *
    `, [transactionId, booking.id, req.user.id, paymentMethod, total]);
    const payment = paymentResult.rows[0];
 
    // 3. Buat transaksi Snap di Midtrans SEBELUM commit — kalau Midtrans
    //    error (misal server key salah), seluruh insert di atas ikut rollback
    //    supaya tidak ada booking "hantu" tanpa transaksi gateway yang valid.
    //    enabledPayments dipetakan dari paymentMethod yang SUDAH dipilih user
    //    di app, supaya Snap langsung ke flow metode itu — tidak nampilin
    //    daftar pilihan metode lagi (redundan sama halaman pilih di app).
    const snapResult = await midtransService.createTransaction({
      orderId: transactionId,
      grossAmount: total * USD_TO_IDR_RATE,
      customer: { name: req.user.name, email: req.user.email },
      itemName: `Sasacation - ${hotel.name} (${nights} malam)`,
      enabledPayments: midtransService.mapToEnabledPayments(paymentMethod),
    });
 
    await client.query('COMMIT');
 
    res.json({
      success: true,
      message: 'Silakan selesaikan pembayaran',
      data: {
        booking: { ...booking, hotel: { id: hotel.id, name: hotel.name, location: hotel.location, image: hotel.image } },
        payment: {
          transactionId: payment.transaction_id,
          method: payment.method,
          amount: Number(payment.amount),
          status: payment.status, // 'pending'
        },
        snapToken: snapResult.token,
        redirectUrl: snapResult.redirect_url,
      },
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[processPayment] error:', e.message, e.stack);
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  } finally {
    client.release();
  }
};
 
// POST /api/checkout/webhook/midtrans
// Dipanggil oleh SERVER Midtrans (bukan oleh app Flutter), jadi TIDAK pakai
// authMiddleware. Keamanannya bergantung sepenuhnya pada verifikasi
// signature_key, bukan token JWT.
const handleMidtransWebhook = async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      order_id: orderId,
      status_code: statusCode,
      gross_amount: grossAmount,
      signature_key: signatureKey,
      transaction_status: transactionStatus,
      fraud_status: fraudStatus,
    } = req.body;
 
    const isValid = midtransService.verifySignature({ orderId, statusCode, grossAmount, signatureKey });
    if (!isValid) {
      // Selalu balas 200 ke Midtrans supaya tidak retry terus, tapi JANGAN
      // proses apapun kalau signature tidak valid (mencegah spoofing).
      console.warn(`[midtrans webhook] signature tidak valid untuk order_id=${orderId}`);
      return res.status(200).json({ success: false, message: 'Invalid signature' });
    }
 
    const newStatus = midtransService.mapTransactionStatus(transactionStatus, fraudStatus);
 
    await client.query('BEGIN');
 
    const paymentResult = await client.query(
      `UPDATE payments
       SET status = $1,
           paid_at = CASE WHEN $1 = 'success' THEN NOW() ELSE paid_at END,
           gateway_response = $2
       WHERE transaction_id = $3
       RETURNING *`,
      [newStatus, JSON.stringify(req.body), orderId]
    );
 
    if (paymentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      console.warn(`[midtrans webhook] payment dengan transaction_id=${orderId} tidak ditemukan`);
      return res.status(200).json({ success: false, message: 'Payment not found' });
    }
 
    const payment = paymentResult.rows[0];
 
    // Kalau pembayaran gagal/expired, booking terkait ikut dibatalkan
    // otomatis — jangan biarkan booking 'confirmed' menggantung tanpa
    // pembayaran yang valid.
    if (newStatus === 'failed') {
      await client.query(
        `UPDATE bookings SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND status = 'confirmed'`,
        [payment.booking_id]
      );
    }
 
    await client.query('COMMIT');
    console.log(`[midtrans webhook] order_id=${orderId} -> ${newStatus}`);
    res.status(200).json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[midtrans webhook] error:', e.message);
    // Tetap 200 supaya Midtrans tidak spam-retry kalau errornya di sisi kita
    // sendiri (mis. DB down sesaat) — bisa direkonsiliasi manual lewat log.
    res.status(200).json({ success: false, message: 'Internal error' });
  } finally {
    client.release();
  }
};
 
// GET /api/checkout/status/:transactionId
// Dipanggil app Flutter untuk polling status setelah membuka halaman Snap —
// status sebenarnya di-update oleh handleMidtransWebhook secara async, jadi
// app perlu tanya-tanya sampai statusnya final (success/failed), bukan
// langsung tahu dari response /pay tadi (yang cuma tahu 'pending').
const getPaymentStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { rows } = await pool.query(`
      SELECT
        p.transaction_id, p.method, p.amount, p.status AS payment_status, p.paid_at,
        b.booking_code, b.check_in, b.check_out, b.nights, b.status AS booking_status,
        h.name AS hotel_name
      FROM payments p
      JOIN bookings b ON b.id = p.booking_id
      JOIN hotels h ON h.id = b.hotel_id
      WHERE p.transaction_id = $1 AND p.user_id = $2
    `, [transactionId, req.user.id]);
 
    if (rows.length === 0)
      return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan' });
 
    const row = rows[0];
    res.json({
      success: true,
      data: {
        payment: {
          transactionId: row.transaction_id,
          method: row.method,
          amount: Number(row.amount),
          status: row.payment_status, // 'pending' | 'success' | 'failed' | 'refunded'
          paidAt: row.paid_at,
        },
        booking: {
          bookingCode: row.booking_code,
          hotelName: row.hotel_name,
          checkIn: row.check_in,
          checkOut: row.check_out,
          nights: row.nights,
          status: row.booking_status,
        },
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};
 
module.exports = { getPaymentMethods, initiateCheckout, processPayment, handleMidtransWebhook, getPaymentStatus };