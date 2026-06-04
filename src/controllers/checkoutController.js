const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');

// In-memory payments store


// Payment methods available (mock)
const PAYMENT_METHODS = [
  { id: 'credit_card', label: 'Kartu Kredit / Debit', icon: 'credit_card', available: true },
  { id: 'bank_transfer', label: 'Transfer Bank', icon: 'account_balance', available: true },
  { id: 'gopay', label: 'GoPay', icon: 'account_balance_wallet', available: true },
  { id: 'ovo', label: 'OVO', icon: 'account_balance_wallet', available: true },
  { id: 'dana', label: 'DANA', icon: 'account_balance_wallet', available: true },
  { id: 'qris', label: 'QRIS', icon: 'qr_code_scanner', available: true },
];

// GET /api/checkout/methods
const getPaymentMethods = (req, res) => {
  res.json({ success: true, data: PAYMENT_METHODS });
};

// POST /api/checkout/initiate
// Body: { hotelId, checkIn, checkOut, guestCount, notes? }
// Creates a checkout session before payment
const initiateCheckout = (req, res) => {
  try {
    const { hotelId, checkIn, checkOut, guestCount, notes } = req.body;

    if (!hotelId || !checkIn || !checkOut || !guestCount) {
      return res.status(400).json({
        success: false,
        message: 'hotelId, checkIn, checkOut, guestCount wajib diisi',
      });
    }

    const hotel = db.hotels.find(h => h.id === hotelId);
    if (!hotel) {
      return res.status(404).json({ success: false, message: 'Hotel tidak ditemukan' });
    }

    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);
    const nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));

    if (nights <= 0) {
      return res.status(400).json({ success: false, message: 'Tanggal checkout harus setelah checkin' });
    }

    const subtotal = hotel.price * nights;
    const taxRate = 0.11; // 11% PPN
    const serviceFee = 15;
    const tax = Math.round(subtotal * taxRate);
    const total = subtotal + tax + serviceFee;

    const checkoutSession = {
      sessionId: uuidv4(),
      userId: req.user.id,
      hotel: {
        id: hotel.id,
        name: hotel.name,
        location: hotel.location,
        image: hotel.image,
        rating: hotel.rating,
        amenities: hotel.amenities,
      },
      checkIn: checkInDate.toISOString(),
      checkOut: checkOutDate.toISOString(),
      nights,
      guestCount: Number(guestCount),
      notes: notes || '',
      pricing: {
        pricePerNight: hotel.price,
        subtotal,
        tax,
        taxRate: taxRate * 100,
        serviceFee,
        total,
        currency: 'USD',
      },
      paymentMethods: PAYMENT_METHODS,
      status: 'pending',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 menit
      createdAt: new Date().toISOString(),
    };

    // Store session (in-memory, production: Redis)
    
    db.checkoutSessions.push(checkoutSession);

    res.json({ success: true, data: checkoutSession });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// POST /api/checkout/pay
// Body: { sessionId, paymentMethod, paymentDetails? }
const processPayment = (req, res) => {
  try {
    const { sessionId, paymentMethod, paymentDetails } = req.body;

    if (!sessionId || !paymentMethod) {
      return res.status(400).json({ success: false, message: 'sessionId dan paymentMethod wajib diisi' });
    }

    const sessionIdx = (db.checkoutSessions || []).findIndex(
      s => s.sessionId === sessionId && s.userId === req.user.id
    );

    if (sessionIdx === -1) {
      return res.status(404).json({ success: false, message: 'Checkout session tidak ditemukan' });
    }

    const session = db.checkoutSessions[sessionIdx];

    if (session.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Session sudah tidak aktif' });
    }

    if (new Date(session.expiresAt) < new Date()) {
      return res.status(400).json({ success: false, message: 'Checkout session sudah expired' });
    }

    // Simulate payment processing (mock success)
    const paymentSuccess = true; // Di production: call payment gateway

    if (!paymentSuccess) {
      return res.status(402).json({ success: false, message: 'Pembayaran gagal' });
    }

    // Create booking
    const booking = {
      id: uuidv4(),
      userId: req.user.id,
      userName: db.users.find(u => u.id === req.user.id)?.name || 'User',
      hotelId: session.hotel.id,
      hotelName: session.hotel.name,
      hotelLocation: session.hotel.location,
      hotelImage: session.hotel.image,
      checkIn: session.checkIn,
      checkOut: session.checkOut,
      nights: session.nights,
      guestCount: session.guestCount,
      pricePerNight: session.pricing.pricePerNight,
      totalPrice: session.pricing.total,
      notes: session.notes,
      status: 'confirmed',
      bookingCode: 'SAC-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
      createdAt: new Date().toISOString(),
    };

    db.bookings.push(booking);

    // Create payment record
    const payment = {
      id: uuidv4(),
      bookingId: booking.id,
      userId: req.user.id,
      sessionId,
      method: paymentMethod,
      amount: session.pricing.total,
      currency: 'USD',
      status: 'success',
      transactionId: 'TXN-' + Date.now(),
      paidAt: new Date().toISOString(),
      details: paymentDetails || {},
    };

    db.payments.push(payment);

    // Mark session as completed
    db.checkoutSessions[sessionIdx].status = 'completed';

    res.json({
      success: true,
      message: 'Pembayaran berhasil!',
      data: {
        booking,
        payment: {
          transactionId: payment.transactionId,
          method: payment.method,
          amount: payment.amount,
          status: payment.status,
          paidAt: payment.paidAt,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// GET /api/checkout/session/:sessionId
const getSession = (req, res) => {
  const session = (db.checkoutSessions || []).find(
    s => s.sessionId === req.params.sessionId && s.userId === req.user.id
  );
  if (!session) {
    return res.status(404).json({ success: false, message: 'Session tidak ditemukan' });
  }
  res.json({ success: true, data: session });
};

module.exports = { getPaymentMethods, initiateCheckout, processPayment, getSession };
