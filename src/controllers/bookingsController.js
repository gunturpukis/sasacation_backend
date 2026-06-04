const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');

// GET /api/bookings/my   - booking milik user yang login
const getMyBookings = (req, res) => {
  const bookings = db.bookings
    .filter(b => b.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Enrich dengan data hotel
  const enriched = bookings.map(b => {
    const hotel = db.hotels.find(h => h.id === b.hotelId);
    return { ...b, hotel: hotel || null };
  });

  res.json({ success: true, data: enriched });
};

// GET /api/bookings/:id
const getBookingById = (req, res) => {
  const booking = db.bookings.find(b => b.id === req.params.id);
  if (!booking) return res.status(404).json({ success: false, message: 'Booking tidak ditemukan' });
  if (booking.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Akses ditolak' });
  }

  const hotel = db.hotels.find(h => h.id === booking.hotelId);
  res.json({ success: true, data: { ...booking, hotel: hotel || null } });
};

// POST /api/bookings
const createBooking = (req, res) => {
  const { hotelId, checkIn, checkOut, guestCount, notes } = req.body;

  if (!hotelId || !checkIn || !checkOut || !guestCount) {
    return res.status(400).json({ success: false, message: 'hotelId, checkIn, checkOut, dan guestCount wajib diisi' });
  }

  const hotel = db.hotels.find(h => h.id === hotelId);
  if (!hotel) return res.status(404).json({ success: false, message: 'Hotel tidak ditemukan' });
  if (!hotel.available) return res.status(400).json({ success: false, message: 'Hotel tidak tersedia' });

  const checkInDate = new Date(checkIn);
  const checkOutDate = new Date(checkOut);
  if (checkOutDate <= checkInDate) {
    return res.status(400).json({ success: false, message: 'Tanggal check-out harus setelah check-in' });
  }

  const nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
  const totalPrice = hotel.price * nights;

  const newBooking = {
    id: uuidv4(),
    userId: req.user.id,
    userName: req.user.name,
    hotelId,
    hotelName: hotel.name,
    hotelLocation: hotel.location,
    hotelImage: hotel.image,
    checkIn: checkInDate.toISOString(),
    checkOut: checkOutDate.toISOString(),
    nights,
    guestCount: Number(guestCount),
    pricePerNight: hotel.price,
    totalPrice,
    notes: notes || '',
    status: 'confirmed', // confirmed | cancelled | completed
    bookingCode: 'SAC-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
    createdAt: new Date().toISOString(),
  };

  db.bookings.push(newBooking);
  res.status(201).json({
    success: true,
    message: 'Booking berhasil dibuat',
    data: { ...newBooking, hotel },
  });
};

// PATCH /api/bookings/:id/cancel
const cancelBooking = (req, res) => {
  const idx = db.bookings.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'Booking tidak ditemukan' });

  const booking = db.bookings[idx];
  if (booking.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Akses ditolak' });
  }
  if (booking.status === 'cancelled') {
    return res.status(400).json({ success: false, message: 'Booking sudah dibatalkan' });
  }

  db.bookings[idx].status = 'cancelled';
  res.json({ success: true, message: 'Booking berhasil dibatalkan', data: db.bookings[idx] });
};

// GET /api/bookings  (admin only)
const getAllBookings = (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  let bookings = [...db.bookings];
  if (status) bookings = bookings.filter(b => b.status === status);
  bookings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const total = bookings.length;
  const startIdx = (Number(page) - 1) * Number(limit);
  const paginated = bookings.slice(startIdx, startIdx + Number(limit));

  res.json({
    success: true,
    data: paginated,
    meta: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) },
  });
};

module.exports = { getMyBookings, getBookingById, createBooking, cancelBooking, getAllBookings };
