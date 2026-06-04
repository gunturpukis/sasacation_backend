const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');

// GET /api/hotels
const getHotels = (req, res) => {
  const { featured, search, minPrice, maxPrice, page = 1, limit = 10 } = req.query;

  let hotels = [...db.hotels];

  if (featured === 'true') hotels = hotels.filter(h => h.featured);
  if (search) hotels = hotels.filter(h =>
    h.name.toLowerCase().includes(search.toLowerCase()) ||
    h.location.toLowerCase().includes(search.toLowerCase())
  );
  if (minPrice) hotels = hotels.filter(h => h.price >= Number(minPrice));
  if (maxPrice) hotels = hotels.filter(h => h.price <= Number(maxPrice));

  const total = hotels.length;
  const startIdx = (Number(page) - 1) * Number(limit);
  const paginated = hotels.slice(startIdx, startIdx + Number(limit));

  res.json({
    success: true,
    data: paginated,
    meta: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) },
  });
};

// GET /api/hotels/:id
const getHotelById = (req, res) => {
  const hotel = db.hotels.find(h => h.id === req.params.id);
  if (!hotel) return res.status(404).json({ success: false, message: 'Hotel tidak ditemukan' });
  res.json({ success: true, data: hotel });
};

// POST /api/hotels  (admin only)
const createHotel = (req, res) => {
  const { name, location, address, price, image, images, description, amenities, featured } = req.body;
  if (!name || !location || !price) {
    return res.status(400).json({ success: false, message: 'Nama, lokasi, dan harga wajib diisi' });
  }
  const newHotel = {
    id: uuidv4(),
    name, location, address: address || '', price: Number(price),
    rating: 0, reviewCount: 0,
    image: image || '', images: images || [],
    description: description || '', amenities: amenities || [],
    category: 'Hotels', type: 'hotel',
    featured: featured || false, available: true,
  };
  db.hotels.push(newHotel);
  res.status(201).json({ success: true, message: 'Hotel berhasil ditambahkan', data: newHotel });
};

// PUT /api/hotels/:id  (admin only)
const updateHotel = (req, res) => {
  const idx = db.hotels.findIndex(h => h.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'Hotel tidak ditemukan' });

  db.hotels[idx] = { ...db.hotels[idx], ...req.body, id: req.params.id };
  res.json({ success: true, message: 'Hotel berhasil diupdate', data: db.hotels[idx] });
};

// DELETE /api/hotels/:id  (admin only)
const deleteHotel = (req, res) => {
  const idx = db.hotels.findIndex(h => h.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'Hotel tidak ditemukan' });

  db.hotels.splice(idx, 1);
  res.json({ success: true, message: 'Hotel berhasil dihapus' });
};

module.exports = { getHotels, getHotelById, createHotel, updateHotel, deleteHotel };
