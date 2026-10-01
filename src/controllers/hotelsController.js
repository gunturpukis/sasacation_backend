const pool = require('../config/db');

const getHotels = async (req, res) => {
  try {
    // B3 (layar Search Figma): + `amenities` (koma, cocok SEMUA) + `sort`.
    const { featured, search, minPrice, maxPrice, amenities, sort, page = 1, limit = 10 } = req.query;
    const conditions = ['available = true'];
    const params = [];

    if (featured === 'true') conditions.push('featured = true');
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(name ILIKE $${params.length} OR location ILIKE $${params.length})`);
    }
    if (minPrice) { params.push(Number(minPrice)); conditions.push(`price >= $${params.length}`); }
    if (maxPrice) { params.push(Number(maxPrice)); conditions.push(`price <= $${params.length}`); }
    if (amenities) {
      const list = String(amenities).split(',').map(s => s.trim()).filter(Boolean).slice(0, 10);
      if (list.length > 0) {
        params.push(list);
        conditions.push(`amenities @> $${params.length}::text[]`);
      }
    }

    // Sort allowlist (default = perilaku lama). Nilai lain → 400 agar typo
    // ketahuan saat develop, bukan hasil acak.
    const SORTS = {
      rating: 'featured DESC, rating DESC NULLS LAST',
      price_asc: 'price ASC',
      price_desc: 'price DESC',
      newest: 'created_at DESC',
    };
    const orderBy = SORTS[sort] || SORTS.rating;
    if (sort && !SORTS[sort])
      return res.status(400).json({ success: false, message: `sort tidak dikenal. Pilih dari: ${Object.keys(SORTS).join(', ')}` });

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await pool.query(`SELECT COUNT(*) FROM hotels ${where}`, params);
    const total = Number(countResult.rows[0].count);

    params.push(Number(limit), (Number(page) - 1) * Number(limit));
    const { rows } = await pool.query(
      `SELECT * FROM hotels ${where} ORDER BY ${orderBy} LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ success: true, data: rows, meta: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

const getHotelById = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM hotels WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Hotel tidak ditemukan' });
    const hotel = rows[0];

    // P1 (FLUTTER_P3_CONTRACTS.md): Guest Reviews. Flutter render section
    // + bottom sheet "See all" bila ada array `reviews`. Key mengikuti
    // kontrak: id, user_name, avatar, rating (angka), stayed, date, text.
    // Item tanpa teks di-skip (filter di SQL). Kalau tabel reviews belum
    // ada (DB lama sebelum migrasi), fallback ke [] agar tidak 500.
    let reviews = [];
    try {
      const { rows: reviewRows } = await pool.query(
        `SELECT id, user_name, avatar, rating, stayed, text, created_at
         FROM reviews
         WHERE hotel_id = $1 AND text IS NOT NULL AND text <> ''
         ORDER BY created_at DESC
         LIMIT 50`,
        [req.params.id]
      );
      reviews = reviewRows.map((r) => ({
        id: r.id,
        user_name: r.user_name,
        avatar: r.avatar || null,
        rating: r.rating === null ? null : Number(r.rating),
        stayed: r.stayed || null,
        date: r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : null,
        text: r.text,
      }));
    } catch (e) {
      // 42P01 = undefined_table → DB belum dimigrasi, biarkan reviews = []
      if (e.code !== '42P01') throw e;
    }

    res.json({ success: true, data: { ...hotel, reviews } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// GET /api/hotels/nearby?lat=&lng=&radius=10&limit=20
// Hotel terdekat dari koordinat yang dikirim (biasanya lokasi GPS user saat ini).
// Jarak dihitung dengan formula Haversine langsung di SQL (dalam kilometer),
// hanya hotel yang punya latitude/longitude yang ikut dihitung.
const getNearbyHotels = async (req, res) => {
  try {
    const { lat, lng, radius = 25, limit = 20 } = req.query;
    if (lat === undefined || lng === undefined)
      return res.status(400).json({ success: false, message: 'lat dan lng wajib diisi' });

    const latitude = Number(lat);
    const longitude = Number(lng);
    const radiusKm = Number(radius);
    if (Number.isNaN(latitude) || Number.isNaN(longitude))
      return res.status(400).json({ success: false, message: 'lat dan lng harus berupa angka' });

    const { rows } = await pool.query(
      `
      SELECT *, distance_km FROM (
        SELECT *,
          (
            6371 * acos(
              LEAST(1, GREATEST(-1,
                cos(radians($1)) * cos(radians(latitude)) *
                cos(radians(longitude) - radians($2)) +
                sin(radians($1)) * sin(radians(latitude))
              ))
            )
          ) AS distance_km
        FROM hotels
        WHERE available = true AND latitude IS NOT NULL AND longitude IS NOT NULL
      ) sub
      WHERE distance_km <= $3
      ORDER BY distance_km ASC
      LIMIT $4
      `,
      [latitude, longitude, radiusKm, Number(limit)]
    );

    res.json({ success: true, data: rows, meta: { lat: latitude, lng: longitude, radiusKm } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// Ambil property_id milik user yang login (harus 'verified'). Dipakai untuk
// membatasi mitra hanya bisa kelola hotel milik properti mereka sendiri.
async function getOwnedPropertyId(userId) {
  const { rows } = await pool.query(
    `SELECT id FROM properties WHERE owner_id = $1 AND status = 'verified'`,
    [userId]
  );
  return rows[0]?.id || null;
}

// GET /api/hotels/my
// Auth: partner (atau admin). Daftar hotel milik properti sendiri — beda
// dari GET /hotels yang publik dan cuma nampilin available=true.
const getMyHotels = async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      // Admin tanpa properti sendiri: tampilkan semua hotel utk oversight.
      const { rows } = await pool.query('SELECT * FROM hotels ORDER BY created_at DESC');
      return res.json({ success: true, data: rows });
    }

    const propertyId = await getOwnedPropertyId(req.user.id);
    if (!propertyId)
      return res.status(403).json({ success: false, message: 'Anda belum menjadi mitra terverifikasi' });

    const { rows } = await pool.query(
      'SELECT * FROM hotels WHERE property_id = $1 ORDER BY created_at DESC',
      [propertyId]
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// POST /api/hotels
// Auth: partner (atau admin). property_id SELALU diambil dari akun yang
// login (bukan dari body request) — supaya mitra tidak bisa membuat hotel
// atas nama properti mitra lain.
const createHotel = async (req, res) => {
  try {
    const { name, location, address, price, description, amenities, image, images, latitude, longitude } = req.body;
    if (!name || !location || !price)
      return res.status(400).json({ success: false, message: 'name, location, price wajib diisi' });

    let propertyId = null;
    if (req.user.role !== 'admin') {
      propertyId = await getOwnedPropertyId(req.user.id);
      if (!propertyId)
        return res.status(403).json({ success: false, message: 'Anda belum menjadi mitra terverifikasi' });
    }

    const { rows } = await pool.query(
      `INSERT INTO hotels (name, location, address, price, description, amenities, image, images, latitude, longitude, property_id, available)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
       RETURNING *`,
      [
        name, location, address || null, price, description || null,
        amenities || [], image || '', images || [],
        latitude ?? null, longitude ?? null, propertyId,
      ]
    );
    res.status(201).json({ success: true, message: 'Hotel berhasil dibuat', data: rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// Cek apakah req.user berhak mengubah hotel ini (pemilik properti terkait,
// atau admin). Return hotel row kalau boleh, null kalau tidak ditemukan,
// throw kalau ditemukan tapi tidak berhak (403).
async function assertHotelOwnership(hotelId, user) {
  const { rows } = await pool.query('SELECT * FROM hotels WHERE id = $1', [hotelId]);
  if (rows.length === 0) return { hotel: null, forbidden: false };
  const hotel = rows[0];
  if (user.role === 'admin') return { hotel, forbidden: false };

  const propertyId = await getOwnedPropertyId(user.id);
  const forbidden = !propertyId || hotel.property_id !== propertyId;
  return { hotel, forbidden };
}

// PUT /api/hotels/:id
const updateHotel = async (req, res) => {
  try {
    const { hotel, forbidden } = await assertHotelOwnership(req.params.id, req.user);
    if (!hotel) return res.status(404).json({ success: false, message: 'Hotel tidak ditemukan' });
    if (forbidden) return res.status(403).json({ success: false, message: 'Anda tidak berhak mengubah hotel ini' });

    const { name, location, address, price, description, amenities, image, images, latitude, longitude, available } = req.body;
    const { rows } = await pool.query(
      `UPDATE hotels SET
         name        = COALESCE($1, name),
         location    = COALESCE($2, location),
         address     = COALESCE($3, address),
         price       = COALESCE($4, price),
         description = COALESCE($5, description),
         amenities   = COALESCE($6, amenities),
         image       = COALESCE($7, image),
         images      = COALESCE($8, images),
         latitude    = COALESCE($9, latitude),
         longitude   = COALESCE($10, longitude),
         available   = COALESCE($11, available),
         updated_at  = NOW()
       WHERE id = $12
       RETURNING *`,
      [name, location, address, price, description, amenities, image, images, latitude, longitude, available, req.params.id]
    );
    res.json({ success: true, message: 'Hotel berhasil diperbarui', data: rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

// DELETE /api/hotels/:id
// Soft-delete (available = false) alih-alih hapus baris fisik — hotel bisa
// saja masih direferensikan oleh booking lama (riwayat transaksi harus tetap
// utuh), jadi "hapus" di sini berarti "sembunyikan dari listing publik".
const deleteHotel = async (req, res) => {
  try {
    const { hotel, forbidden } = await assertHotelOwnership(req.params.id, req.user);
    if (!hotel) return res.status(404).json({ success: false, message: 'Hotel tidak ditemukan' });
    if (forbidden) return res.status(403).json({ success: false, message: 'Anda tidak berhak menghapus hotel ini' });

    await pool.query(`UPDATE hotels SET available = false, updated_at = NOW() WHERE id = $1`, [req.params.id]);
    res.json({ success: true, message: 'Hotel berhasil dinonaktifkan dari listing' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error', error: e.message });
  }
};

module.exports = { getHotels, getHotelById, getNearbyHotels, getMyHotels, createHotel, updateHotel, deleteHotel };
