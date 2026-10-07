// const pool = require('../config/db');
// const midtransService = require('../services/midtransService');
// const { sendToToken } = require('../services/notificationService');
 
// const PAYMENT_METHODS = [
//   { id: 'credit_card',   label: 'Kartu Kredit / Debit', icon: 'credit_card',           available: true },
//   { id: 'bank_transfer', label: 'Transfer Bank',         icon: 'account_balance',        available: true },
//   { id: 'gopay',         label: 'GoPay',                 icon: 'account_balance_wallet', available: true },
//   { id: 'ovo',           label: 'OVO',                   icon: 'account_balance_wallet', available: true },
//   { id: 'dana',          label: 'DANA',                  icon: 'account_balance_wallet', available: true },
//   { id: 'qris',          label: 'QRIS',                  icon: 'qr_code_scanner',        available: true },
// ];
 
// // Midtrans (region Indonesia) hanya menerima gross_amount dalam IDR — tidak
// // ada parameter currency di Snap API standar. Harga Sasacation ditampilkan
// // dalam USD, jadi perlu dikonversi SAAT membuat transaksi ke Midtrans saja
// // (tampilan USD di app/DB tidak berubah). Rate di-env-kan supaya gampang
// // disesuaikan, TAPI ini tetap simplifikasi — untuk production sebaiknya
// // harga disimpan native dalam IDR, karena kurs realtime butuh third-party
// // rate provider yang juga perlu di-refresh berkala.
// const USD_TO_IDR_RATE = Number(process.env.MIDTRANS_USD_TO_IDR_RATE || 16000);
 
// // GET /api/checkout/methods
// const getPaymentMethods = (_req, res) => {
//   res.json({ success: true, data: PAYMENT_METHODS });
// };
 
// // POST /api/checkout/initiate
// // Hitung harga (subtotal + pajak + biaya layanan), belum simpan ke DB
// const initiateCheckout = async (req, res) => {
//   try {
//     const { hotelId, checkIn, checkOut, guestCount, notes } = req.body;
//     if (!hotelId || !checkIn || !checkOut || !guestCount)
//       return res.status(400).json({ success: false, message: 'hotelId, checkIn, checkOut, guestCount wajib diisi' });
 
//     const { rows } = await pool.query('SELECT * FROM hotels WHERE id = $1 AND available = true', [hotelId]);
//     if (rows.length === 0)
//       return res.status(404).json({ success: false, message: 'Hotel tidak ditemukan' });
//     const hotel = rows[0];
 
//     const checkInDate = new Date(checkIn);
//     const checkOutDate = new Date(checkOut);
//     const nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
//     if (nights <= 0)
//       return res.status(400).json({ success: false, message: 'Tanggal checkout harus setelah checkin' });
 
//     const pricePerNight = Number(hotel.price);
//     const subtotal = pricePerNight * nights;
//     const taxRate = 0.11;
//     const serviceFee = 15;
//     const tax = Math.round(subtotal * taxRate);
//     const total = subtotal + tax + serviceFee;
 
//     res.json({
//       success: true,
//       data: {
//         hotel: {
//           id: hotel.id, name: hotel.name, location: hotel.location,
//           image: hotel.image, rating: hotel.rating, amenities: hotel.amenities,
//         },
//         checkIn: checkInDate.toISOString(),
//         checkOut: checkOutDate.toISOString(),
//         nights,
//         guestCount: Number(guestCount),
//         notes: notes || '',
//         pricing: { pricePerNight, subtotal, tax, taxRate: taxRate * 100, serviceFee, total, currency: 'USD' },
//         paymentMethods: PAYMENT_METHODS,
//         expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
//       },
//     });
//   } catch (e) {
//     res.status(500).json({ success: false, message: 'Server error', error: e.message });
//   }
// };
 
// // POST /api/checkout/pay
// // FIX UTAMA: sebelumnya endpoint ini langsung set payment.status = 'success'
// // tanpa pernah menyentuh payment gateway — sekarang booking + payment dibuat
// // dalam status 'pending', lalu transaksi Snap Midtrans dibuat dan snapToken
// // dikembalikan ke client untuk membuka halaman pembayaran asli. Status baru
// // benar-benar jadi 'success'/'failed' lewat webhook (lihat handleWebhook).
// const processPayment = async (req, res) => {
//   const client = await pool.connect();
//   try {
//     const { hotelId, checkIn, checkOut, guestCount, notes, paymentMethod } = req.body;
//     if (!hotelId || !checkIn || !checkOut || !guestCount || !paymentMethod)
//       return res.status(400).json({ success: false, message: 'Data pembayaran tidak lengkap' });
 
//     const { rows: hotelRows } = await client.query('SELECT * FROM hotels WHERE id = $1', [hotelId]);
//     if (hotelRows.length === 0)
//       return res.status(404).json({ success: false, message: 'Hotel tidak ditemukan' });
//     const hotel = hotelRows[0];
 
//     const checkInDate = new Date(checkIn);
//     const checkOutDate = new Date(checkOut);
//     const nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
//     const pricePerNight = Number(hotel.price);
//     const subtotal = pricePerNight * nights;
//     const total = subtotal + Math.round(subtotal * 0.11) + 15;
 
//     const bookingCode = 'SAC-' + Math.random().toString(36).substring(2, 8).toUpperCase();
//     const transactionId = 'TXN-' + Date.now();
 
//     await client.query('BEGIN');
 
//     // 1. Buat booking (tetap 'confirmed' — kalau pembayaran gagal/expired,
//     //    webhook yang akan membatalkannya, lihat handleWebhook di bawah)
//     const bookingResult = await client.query(`
//       INSERT INTO bookings (booking_code, user_id, hotel_id, check_in, check_out, nights, guest_count, price_per_night, total_price, notes, status)
//       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'confirmed')
//       RETURNING *
//     `, [bookingCode, req.user.id, hotelId, checkInDate, checkOutDate, nights, guestCount, pricePerNight, total, notes || '']);
//     const booking = bookingResult.rows[0];
 
//     // 2. Buat payment dengan status 'pending' — BUKAN 'success' lagi
//     const paymentResult = await client.query(`
//       INSERT INTO payments (transaction_id, booking_id, user_id, method, amount, currency, status)
//       VALUES ($1,$2,$3,$4,$5,'USD','pending')
//       RETURNING *
//     `, [transactionId, booking.id, req.user.id, paymentMethod, total]);
//     const payment = paymentResult.rows[0];
 
//     // 3. Buat transaksi Snap di Midtrans SEBELUM commit — kalau Midtrans
//     //    error (misal server key salah), seluruh insert di atas ikut rollback
//     //    supaya tidak ada booking "hantu" tanpa transaksi gateway yang valid.
//     //    enabledPayments dipetakan dari paymentMethod yang SUDAH dipilih user
//     //    di app, supaya Snap langsung ke flow metode itu — tidak nampilin
//     //    daftar pilihan metode lagi (redundan sama halaman pilih di app).
//     const snapResult = await midtransService.createTransaction({
//       orderId: transactionId,
//       grossAmount: total * USD_TO_IDR_RATE,
//       customer: { name: req.user.name, email: req.user.email },
//       itemName: `Sasacation - ${hotel.name} (${nights} malam)`,
//       enabledPayments: midtransService.mapToEnabledPayments(paymentMethod),
//     });
 
//     await client.query('COMMIT');
 
//     res.json({
//       success: true,
//       message: 'Silakan selesaikan pembayaran',
//       data: {
//         booking: { ...booking, hotel: { id: hotel.id, name: hotel.name, location: hotel.location, image: hotel.image } },
//         payment: {
//           transactionId: payment.transaction_id,
//           method: payment.method,
//           amount: Number(payment.amount),
//           status: payment.status, // 'pending'
//         },
//         snapToken: snapResult.token,
//         redirectUrl: snapResult.redirect_url,
//       },
//     });
//   } catch (e) {
//     await client.query('ROLLBACK');
//     console.error('[processPayment] error:', e.message, e.stack);
//     res.status(500).json({ success: false, message: 'Server error', error: e.message });
//   } finally {
//     client.release();
//   }
// };
 
// // POST /api/checkout/webhook/midtrans
// // Dipanggil oleh SERVER Midtrans (bukan oleh app Flutter), jadi TIDAK pakai
// // authMiddleware. Keamanannya bergantung sepenuhnya pada verifikasi
// // signature_key, bukan token JWT.
// const handleMidtransWebhook = async (req, res) => {
//   const client = await pool.connect();
//   try {
//     const {
//       order_id: orderId,
//       status_code: statusCode,
//       gross_amount: grossAmount,
//       signature_key: signatureKey,
//       transaction_status: transactionStatus,
//       fraud_status: fraudStatus,
//     } = req.body;
 
//     const isValid = midtransService.verifySignature({ orderId, statusCode, grossAmount, signatureKey });
//     if (!isValid) {
//       // Selalu balas 200 ke Midtrans supaya tidak retry terus, tapi JANGAN
//       // proses apapun kalau signature tidak valid (mencegah spoofing).
//       console.warn(`[midtrans webhook] signature tidak valid untuk order_id=${orderId}`);
//       return res.status(200).json({ success: false, message: 'Invalid signature' });
//     }
 
//     const newStatus = midtransService.mapTransactionStatus(transactionStatus, fraudStatus);
 
//     await client.query('BEGIN');
 
//     const paymentResult = await client.query(
//       `UPDATE payments
//        SET status = $1,
//            paid_at = CASE WHEN $1 = 'success' THEN NOW() ELSE paid_at END,
//            gateway_response = $2
//        WHERE transaction_id = $3
//        RETURNING *`,
//       [newStatus, JSON.stringify(req.body), orderId]
//     );
 
//     if (paymentResult.rows.length === 0) {
//       await client.query('ROLLBACK');
//       console.warn(`[midtrans webhook] payment dengan transaction_id=${orderId} tidak ditemukan`);
//       return res.status(200).json({ success: false, message: 'Payment not found' });
//     }
 
//     const payment = paymentResult.rows[0];
 
//     // Kalau pembayaran gagal/expired, booking terkait ikut dibatalkan
//     // otomatis — jangan biarkan booking 'confirmed' menggantung tanpa
//     // pembayaran yang valid.
//     if (newStatus === 'failed') {
//       await client.query(
//         `UPDATE bookings SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND status = 'confirmed'`,
//         [payment.booking_id]
//       );
//     }
 
//     await client.query('COMMIT');
//     console.log(`[midtrans webhook] order_id=${orderId} -> ${newStatus}`);
//     res.status(200).json({ success: true });
 
//     // Push notification dikirim SETELAH response ke Midtrans, di luar
//     // transaksi DB — kalau gagal kirim (Firebase belum diset, token user
//     // kosong/expired, dll), itu TIDAK BOLEH menggagalkan konfirmasi
//     // pembayaran yang sudah tercatat sukses. Cukup di-log.
//     if (newStatus === 'success') {
//       notifyPaymentSuccess(payment.booking_id, payment.user_id).catch((err) =>
//         console.error('[midtrans webhook] gagal kirim push notification:', err.message)
//       );
//     }
//   } catch (e) {
//     await client.query('ROLLBACK');
//     console.error('[midtrans webhook] error:', e.message);
//     // Tetap 200 supaya Midtrans tidak spam-retry kalau errornya di sisi kita
//     // sendiri (mis. DB down sesaat) — bisa direkonsiliasi manual lewat log.
//     res.status(200).json({ success: false, message: 'Internal error' });
//   } finally {
//     client.release();
//   }
// };
 
// // Ambil FCM token + detail booking, lalu kirim push notification konfirmasi
// // pembayaran. Dipisah dari handleMidtransWebhook supaya fungsi utamanya
// // tetap fokus ke update status pembayaran, bukan detail notifikasi.
// async function notifyPaymentSuccess(bookingId, userId) {
//   const { rows } = await pool.query(
//     `SELECT u.fcm_token, b.booking_code, b.check_in, h.name AS hotel_name
//      FROM bookings b
//      JOIN hotels h ON h.id = b.hotel_id
//      JOIN users u ON u.id = $2
//      WHERE b.id = $1`,
//     [bookingId, userId]
//   );
 
//   const row = rows[0];
//   if (!row?.fcm_token) return; // user belum register FCM token dari device manapun — skip diam-diam
 
//   const checkInLabel = new Date(row.check_in).toLocaleDateString('id-ID', {
//     day: 'numeric', month: 'long', year: 'numeric',
//   });
 
//   await sendToToken(
//     row.fcm_token,
//     {
//       title: 'Pembayaran Berhasil! 🎉',
//       body: `Booking ${row.booking_code} di ${row.hotel_name} sudah dikonfirmasi. Check-in: ${checkInLabel}.`,
//     },
//     {
//       type: 'payment_success',
//       bookingId: String(bookingId),
//       bookingCode: row.booking_code,
//     }
//   );
// }
 
// // GET /api/checkout/status/:transactionId
// // Dipanggil app Flutter untuk polling status setelah membuka halaman Snap —
// // status sebenarnya di-update oleh handleMidtransWebhook secara async, jadi
// // app perlu tanya-tanya sampai statusnya final (success/failed), bukan
// // langsung tahu dari response /pay tadi (yang cuma tahu 'pending').
// const getPaymentStatus = async (req, res) => {
//   try {
//     const { transactionId } = req.params;
//     const { rows } = await pool.query(`
//       SELECT
//         p.transaction_id, p.method, p.amount, p.status AS payment_status, p.paid_at,
//         b.booking_code, b.check_in, b.check_out, b.nights, b.status AS booking_status,
//         h.name AS hotel_name
//       FROM payments p
//       JOIN bookings b ON b.id = p.booking_id
//       JOIN hotels h ON h.id = b.hotel_id
//       WHERE p.transaction_id = $1 AND p.user_id = $2
//     `, [transactionId, req.user.id]);
 
//     if (rows.length === 0)
//       return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan' });
 
//     const row = rows[0];
//     res.json({
//       success: true,
//       data: {
//         payment: {
//           transactionId: row.transaction_id,
//           method: row.method,
//           amount: Number(row.amount),
//           status: row.payment_status, // 'pending' | 'success' | 'failed' | 'refunded'
//           paidAt: row.paid_at,
//         },
//         booking: {
//           bookingCode: row.booking_code,
//           hotelName: row.hotel_name,
//           checkIn: row.check_in,
//           checkOut: row.check_out,
//           nights: row.nights,
//           status: row.booking_status,
//         },
//       },
//     });
//   } catch (e) {
//     res.status(500).json({ success: false, message: 'Server error', error: e.message });
//   }
// };
 
// module.exports = { getPaymentMethods, initiateCheckout, processPayment, handleMidtransWebhook, getPaymentStatus };
 
 
const pool = require('../config/db');
const midtransService = require('../services/midtransService');
const loyaltyService = require('../services/loyaltyService');
const { captureSavedCard } = require('../services/paymentMethodService');
const { notifyUser, buildAction } = require('../services/notificationService');
 
const PAYMENT_METHODS = [
  { id: 'credit_card',   label: 'Kartu Kredit / Debit', icon: 'credit_card',           available: true },
  { id: 'bank_transfer', label: 'Transfer Bank',         icon: 'account_balance',        available: true },
  { id: 'gopay',         label: 'GoPay',                 icon: 'account_balance_wallet', available: true },
  { id: 'ovo',           label: 'OVO',                   icon: 'account_balance_wallet', available: true },
  { id: 'dana',          label: 'DANA',                  icon: 'account_balance_wallet', available: true },
  { id: 'qris',          label: 'QRIS',                  icon: 'qr_code_scanner',        available: true },
  // B4 (layar book_your_trip Figma): radio PayPal tersimpan. PayPal bukan
  // channel native Midtrans — pemetaan dikosongkan supaya Snap menampilkan
  // semua channel aktif (fallback aman, lihat mapToEnabledPayments).
  { id: 'paypal',        label: 'PayPal',                icon: 'account_balance_wallet', available: true },
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
    // B4 (Price Summary Figma): cleaning fee per properti (kolom hotels).
    const cleaningFee = Number(hotel.cleaning_fee) || 0;
    const tax = Math.round(subtotal * taxRate);
    const total = subtotal + tax + serviceFee + cleaningFee;

    // Loyalty redeem (LOYALTY_DEFINITION.md §2): quote saja di sini, spend
    // dicatat saat POST /pay. pricing.total = yang ditagih (sudah diskon).
    let redeemPoints = 0;
    let discountPoints = 0;
    if (req.body.redeem_points !== undefined) {
      const qty = Number(req.body.redeem_points);
      if (!Number.isInteger(qty)) {
        return res.status(400).json({ success: false, message: 'redeem_points harus bilangan bulat' });
      }
      try {
        const balance = await loyaltyService.getBalance(pool, req.user.id);
        const q = loyaltyService.quoteRedeem({ balance, redeemPoints: qty, subtotalUsd: subtotal });
        redeemPoints = q.redeemPoints;
        discountPoints = q.discountUsd;
      } catch (e) {
        return res.status(e.status || 400).json({ success: false, message: e.message });
      }
    }
    const totalAfterRedeem = Math.max(0, Math.round((total - discountPoints) * 100) / 100);

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
        pricing: { pricePerNight, subtotal, tax, taxRate: taxRate * 100, serviceFee, cleaningFee, total: totalAfterRedeem, discount_points: discountPoints, redeem_points: redeemPoints, currency: 'USD', fx: { currency: 'USD', usd_to_idr_rate: USD_TO_IDR_RATE } },
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
    // FIX audit: sebelumnya tidak ada validasi ini sama sekali — checkOut
    // sebelum checkIn bisa menghasilkan nights negatif/nol, total harga
    // jadi angka yang tidak masuk akal tapi tetap diproses ke Midtrans.
    // (Belum ada transaksi DB aktif di titik ini, jadi cukup return — tidak
    // perlu ROLLBACK.)
    if (!nights || nights <= 0) {
      return res.status(400).json({ success: false, message: 'Tanggal checkout harus setelah checkin' });
    }
    const pricePerNight = Number(hotel.price);
    const subtotal = pricePerNight * nights;
    // B4: rumus HARUS identik dengan initiateCheckout di atas.
    // Snapshot komponen disimpan ke payments untuk invoice (anti-drift tarif).
    const taxAmount = Math.round(subtotal * 0.11);
    const serviceFee = 15;
    const cleaningFee = Number(hotel.cleaning_fee) || 0;
    const fullTotal = subtotal + taxAmount + serviceFee + cleaningFee;

    // Loyalty redeem (LOYALTY_DEFINITION.md §2): quote di sini, spend dicatat
    // dalam transaksi yang sama dengan pembuatan booking di bawah. Tanpa
    // redeem_points → perilaku lama persis (total penuh).
    let redeemPts = 0;
    let redeemDiscount = 0;
    if (req.body.redeem_points !== undefined) {
      const qty = Number(req.body.redeem_points);
      if (!Number.isInteger(qty)) {
        return res.status(400).json({ success: false, message: 'redeem_points harus bilangan bulat' });
      }
      try {
        const balance = await loyaltyService.getBalance(client, req.user.id);
        const q = loyaltyService.quoteRedeem({ balance, redeemPoints: qty, subtotalUsd: subtotal });
        redeemPts = q.redeemPoints;
        redeemDiscount = q.discountUsd;
      } catch (e) {
        return res.status(e.status || 400).json({ success: false, message: e.message });
      }
    }
    const total = Math.max(0, Math.round((fullTotal - redeemDiscount) * 100) / 100);
 
    // FIX audit KRITIS: sebelumnya TIDAK ADA pengecekan ini sama sekali —
    // dua user bisa membayar sukses untuk hotel & tanggal yang sama tanpa
    // sistem tahu ada konflik (double booking). Cek dulu apakah ada booking
    // 'confirmed' lain untuk hotel ini yang tanggalnya overlap. Sama seperti
    // di atas, ini masih sebelum BEGIN, jadi cukup return tanpa ROLLBACK.
    //
    // CATATAN: ini asumsi 1 hotel = 1 unit yang bisa dibooking (exclusive
    // per tanggal). Kalau bisnis Anda punya konsep banyak kamar per hotel
    // (inventory count), validasi ini perlu disesuaikan jadi hitung jumlah
    // booking overlap vs total kamar tersedia, bukan tolak di overlap pertama.
    const overlapCheck = await client.query(
      `SELECT id FROM bookings
       WHERE hotel_id = $1 AND status IN ('pending','confirmed')
         AND check_in < $3 AND check_out > $2`,
      [hotelId, checkInDate, checkOutDate]
    );
    if (overlapCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Hotel ini sudah dibooking untuk tanggal yang Anda pilih. Coba tanggal lain.',
      });
    }
 
    const bookingCode = 'SAC-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const transactionId = 'TXN-' + Date.now();
 
    await client.query('BEGIN');

    // Spend poin redeem dalam transaksi yang sama dengan booking — gagal
    // spend = seluruh pay gagal (tidak ada booking diskon tanpa bayar poin).
    if (redeemPts > 0) {
      await loyaltyService.spendPoints(client, req.user.id, redeemPts, 'redeem', {
        referenceId: `redeem:${transactionId}`,
        note: `Redeem ${redeemPts} poin (diskon $${redeemDiscount}) untuk booking ${bookingCode}`,
      });
    }

    // 1. Buat booking 'pending' (B1) — slot tanggal di-hold; baru jadi
    //    'confirmed' saat webhook sukses, 'cancelled' saat gagal/expired.
    //    total_price = setelah diskon poin (bila redeem).
    const bookingResult = await client.query(`
      INSERT INTO bookings (booking_code, user_id, hotel_id, check_in, check_out, nights, guest_count, price_per_night, total_price, notes, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')
      RETURNING *
    `, [bookingCode, req.user.id, hotelId, checkInDate, checkOutDate, nights, guestCount, pricePerNight, total, notes || '']);
    const booking = bookingResult.rows[0];

    // 2. Buat transaksi Snap di Midtrans SEBELUM insert payment — token &
    //    URL Snap disimpan di baris payment supaya My Trips bisa "Complete
    //    Booking" (resume) tanpa membuat transaksi gateway baru.
    //    Kalau Midtrans error, insert booking di atas ikut rollback supaya
    //    tidak ada booking "hantu" tanpa transaksi gateway yang valid.
    //    enabledPayments dipetakan dari paymentMethod yang SUDAH dipilih user
    //    di app, supaya Snap langsung ke flow metode itu — tidak nampilin
    //    daftar pilihan metode lagi (redundan sama halaman pilih di app).
    //    P4 vault: userId SELALU dikirim supaya Midtrans pre-fill kartu
    //    tersimpan saat returning checkout; saveCard=true (khusus kartu kredit)
    //    menampilkan toggle "save card" di Snap — tokennya dicapture webhook.
    const snapResult = await midtransService.createTransaction({
      orderId: transactionId,
      grossAmount: total * USD_TO_IDR_RATE,
      customer: { name: req.user.name, email: req.user.email },
      itemName: `Sasacation - ${hotel.name} (${nights} malam)`,
      enabledPayments: midtransService.mapToEnabledPayments(paymentMethod),
      userId: req.user.id,
      ...(paymentMethod === 'credit_card' && req.body.saveCard === true
        ? { creditCard: { secure: true, save_card: true } }
        : {}),
    });
    const snapExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // 3. Buat payment 'pending' + data Snap untuk resume.
    const paymentResult = await client.query(`
      INSERT INTO payments (transaction_id, booking_id, user_id, method, amount, currency, status, snap_token, redirect_url, snap_expires_at, tax_amount, service_fee, cleaning_fee, redeemed_points)
      VALUES ($1,$2,$3,$4,$5,'USD','pending',$6,$7,$8,$9,$10,$11,$12)
      RETURNING *
    `, [transactionId, booking.id, req.user.id, paymentMethod, total, snapResult.token, snapResult.redirect_url, snapExpiresAt, taxAmount, serviceFee, cleaningFee, redeemPts]);
    const payment = paymentResult.rows[0];

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
 
    // FIX audit: ambil status SEBELUM di-update, supaya bisa dideteksi
    // apakah ini transisi BARU ke 'success' atau webhook retry dari event
    // yang sudah pernah diproses sebelumnya (Midtrans bisa kirim webhook
    // yang sama lebih dari sekali). Tanpa ini, user bisa terima notifikasi
    // "Pembayaran Berhasil" berkali-kali untuk 1 transaksi yang sama.
    const previousResult = await client.query(
      `SELECT status FROM payments WHERE transaction_id = $1`,
      [orderId]
    );
    const previousStatus = previousResult.rows[0]?.status;
 
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
 
    // B1: booking 'pending' dikonfirmasi saat bayar sukses; yang gagal/
    // expired dibatalkan (pending maupun confirmed menggantung).
    if (newStatus === 'success') {
      await client.query(
        `UPDATE bookings SET status = 'confirmed', updated_at = NOW() WHERE id = $1 AND status = 'pending'`,
        [payment.booking_id]
      );
    }
    if (newStatus === 'failed') {
      await client.query(
        `UPDATE bookings SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND status IN ('pending','confirmed')`,
        [payment.booking_id]
      );
      // Poin redeem kembali karena user tidak jadi menginap (idempotent —
      // retry webhook tidak menggandakan, dan hanya bila sebelumnya pending).
      const redeemed = Number(payment.redeemed_points) || 0;
      if (redeemed > 0 && previousStatus !== 'failed') {
        try {
          await client.query(
            `INSERT INTO loyalty_ledger (user_id, points, type, reference_id, note)
             VALUES ($1, $2, 'recredit', $3, $4)
             ON CONFLICT (reference_id) DO NOTHING`,
            [payment.user_id, redeemed, `recredit:${orderId}`, `Poin kembali — pembayaran ${orderId} gagal/expired`]
          );
          await client.query(
            `UPDATE loyalty_points SET points = points + $1, updated_at = NOW() WHERE user_id = $2`,
            [redeemed, payment.user_id]
          );
        } catch (e) {
          if (e.code !== '42P01') throw e;
        }
      }
    }

    // P4 vault: pembayaran kartu sukses + user centang "save card" di Snap →
    // webhook membawa saved_token_id — persist sebagai metode tersimpan.
    // captureSavedCard tidak pernah throw (diabaikan bila gagal) supaya tidak
    // menggagalkan konfirmasi pembayaran yang sudah valid.
    if (newStatus === 'success') {
      await captureSavedCard(client, payment.user_id, req.body);
    }

    await client.query('COMMIT');
    console.log(`[midtrans webhook] order_id=${orderId} -> ${newStatus}`);
    res.status(200).json({ success: true });
 
    // Push notification dikirim SETELAH response ke Midtrans, di luar
    // transaksi DB — kalau gagal kirim (Firebase belum diset, token user
    // kosong/expired, dll), itu TIDAK BOLEH menggagalkan konfirmasi
    // pembayaran yang sudah tercatat sukses. Cukup di-log.
    if (newStatus === 'success' && previousStatus !== 'success') {
      notifyPaymentSuccess(payment.booking_id, payment.user_id).catch((err) =>
        console.error('[midtrans webhook] gagal kirim push notification:', err.message)
      );
    } else if (newStatus === 'success' && previousStatus === 'success') {
      console.log(`[midtrans webhook] order_id=${orderId} sudah success sebelumnya — skip notifikasi duplikat (kemungkinan webhook retry)`);
    }
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
 
// Ambil FCM token + detail booking, lalu kirim push notification konfirmasi
// pembayaran. Dipisah dari handleMidtransWebhook supaya fungsi utamanya
// tetap fokus ke update status pembayaran, bukan detail notifikasi.
async function notifyPaymentSuccess(bookingId, userId) {
  const { rows } = await pool.query(
    `SELECT u.fcm_token, b.booking_code, b.check_in, h.name AS hotel_name
     FROM bookings b
     JOIN hotels h ON h.id = b.hotel_id
     JOIN users u ON u.id = $2
     WHERE b.id = $1`,
    [bookingId, userId]
  );
 
  const row = rows[0];
  if (!row) return; // booking/user tidak ditemukan — kondisi data tidak valid, skip diam-diam
 
  const checkInLabel = new Date(row.check_in).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
 
  const notification = {
    title: 'Pembayaran Berhasil! 🎉',
    body: `Booking ${row.booking_code} di ${row.hotel_name} sudah dikonfirmasi. Check-in: ${checkInLabel}.`,
  };
  const data = {
    type: 'payment_success',
    bookingId: String(bookingId),
    bookingCode: row.booking_code,
    // P6: action button Figma — Flutter render tombol "Lihat Booking".
    action: buildAction('Lihat Booking', 'booking_detail', { bookingId }),
  };

  // FIX: SEBELUM ini, kalau user belum register FCM token, function return
  // lebih awal dan notifikasi TIDAK PERNAH tersimpan sama sekali — user
  // kehilangan riwayat konfirmasi pembayarannya di Notifications screen
  // padahal pembayarannya sukses. SEKARANG: persist riwayat SELALU jalan,
  // push FCM saja yang butuh token (dan gagal-diam kalau tidak ada/invalid).
  // notifyUser juga flatten `action` ke string untuk payload FCM.
  await notifyUser(userId, row.fcm_token || null, notification, data);
}
 
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

// GET /api/checkout/resume/:bookingId
// B1 (layar My Trips "Complete Booking"): kembalikan URL Snap yang masih
// aktif untuk booking 'pending' milik user — app tinggal buka redirectUrl,
// tanpa membuat transaksi gateway baru. 404 bila tidak ada pembayaran aktif
// (sudah sukses/gagal/expired → app arahkan ke /pay ulang).
const resumePayment = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.transaction_id, p.method, p.amount, p.snap_token, p.redirect_url, p.snap_expires_at,
              b.booking_code, b.status AS booking_status
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       WHERE p.booking_id = $1 AND p.user_id = $2 AND p.status = 'pending'
         AND p.snap_expires_at IS NOT NULL AND p.snap_expires_at > NOW()
       ORDER BY p.created_at DESC
       LIMIT 1`,
      [req.params.bookingId, req.user.id]
    );

    if (rows.length === 0)
      return res.status(404).json({ success: false, message: 'Tidak ada pembayaran aktif untuk booking ini' });

    const row = rows[0];
    res.json({
      success: true,
      data: {
        transactionId: row.transaction_id,
        bookingCode: row.booking_code,
        bookingStatus: row.booking_status,
        method: row.method,
        amount: Number(row.amount),
        snapToken: row.snap_token,
        redirectUrl: row.redirect_url,
        expiresAt: row.snap_expires_at,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

module.exports = { getPaymentMethods, initiateCheckout, processPayment, handleMidtransWebhook, getPaymentStatus, resumePayment };