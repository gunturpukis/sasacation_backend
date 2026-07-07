const pool = require('../config/db');

const PAYMENT_METHODS = [
  { id: 'credit_card',   label: 'Kartu Kredit / Debit', icon: 'credit_card',           available: true },
  { id: 'bank_transfer', label: 'Transfer Bank',         icon: 'account_balance',        available: true },
  { id: 'gopay',         label: 'GoPay',                 icon: 'account_balance_wallet', available: true },
  { id: 'ovo',           label: 'OVO',                   icon: 'account_balance_wallet', available: true },
  { id: 'dana',          label: 'DANA',                  icon: 'account_balance_wallet', available: true },
  { id: 'qris',          label: 'QRIS',                  icon: 'qr_code_scanner',        available: true },
];

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
// Simpan booking + payment ke PostgreSQL dalam SATU transaksi (atomic)
// Kalau salah satu gagal (misal insert payment error), booking ikut di-rollback
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

    // 1. Buat booking
    const bookingResult = await client.query(`
      INSERT INTO bookings (booking_code, user_id, hotel_id, check_in, check_out, nights, guest_count, price_per_night, total_price, notes, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'confirmed')
      RETURNING *
    `, [bookingCode, req.user.id, hotelId, checkInDate, checkOutDate, nights, guestCount, pricePerNight, total, notes || '']);
    const booking = bookingResult.rows[0];

    // 2. Buat payment, terhubung ke booking yang baru dibuat
    const paymentResult = await client.query(`
      INSERT INTO payments (transaction_id, booking_id, user_id, method, amount, currency, status, paid_at)
      VALUES ($1,$2,$3,$4,$5,'USD','success',NOW())
      RETURNING *
    `, [transactionId, booking.id, req.user.id, paymentMethod, total]);
    const payment = paymentResult.rows[0];

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Pembayaran berhasil!',
      data: {
        booking: { ...booking, hotel: { id: hotel.id, name: hotel.name, location: hotel.location, image: hotel.image } },
        payment: {
          transactionId: payment.transaction_id,
          method: payment.method,
          amount: Number(payment.amount),
          status: payment.status,
          paidAt: payment.paid_at,
        },
      },
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  } finally {
    client.release();
  }
};

module.exports = { getPaymentMethods, initiateCheckout, processPayment };
