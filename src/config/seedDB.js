// src/config/seedDB.js
// Jalankan: npm run db:seed
// Mengisi data awal ke PostgreSQL

require('dotenv').config();
const pool = require('./db');
const bcrypt = require('bcryptjs');

const hotels = [
  {
    id: 'a0000001-0000-0000-0000-000000000001',
    name: 'Qunci Villas', location: 'Mangsit Beach',
    address: 'Jl. Raya Senggigi Km 8, Mangsit, Lombok Barat',
    price: 179, rating: 4.8, review_count: 312,
    image: 'https://images.unsplash.com/photo-1571896349842-33c89424de2d',
    images: ['https://images.unsplash.com/photo-1571896349842-33c89424de2d','https://images.unsplash.com/photo-1520250497591-112f2f40a3f4'],
    description: 'Qunci Villas adalah resort bintang 5 yang terletak langsung di tepi pantai Mangsit yang tenang. Dengan 56 villa pribadi yang dikelilingi taman tropis, setiap villa memiliki kolam renang pribadi dan pemandangan langsung ke Selat Lombok.',
    amenities: ['Private Pool','Beach Access','Spa','Restaurant','Bar','WiFi','Airport Transfer'],
    featured: true,
    latitude: -8.5100, longitude: 116.0500,
  },
  {
    id: 'a0000001-0000-0000-0000-000000000002',
    name: 'Oberoi Beach Resort', location: 'Tanjung',
    address: 'Medana Beach, Tanjung, Lombok Utara',
    price: 341, rating: 4.9, review_count: 256,
    image: 'https://images.unsplash.com/photo-1540541338287-41700207dee6',
    images: ['https://images.unsplash.com/photo-1540541338287-41700207dee6'],
    description: 'Oberoi Beach Resort Lombok merupakan salah satu resort paling mewah di Lombok. Terletak di pantai Medana yang terpencil, menawarkan pengalaman eksklusif dengan pemandangan laut yang luar biasa.',
    amenities: ['Private Beach','Infinity Pool','Spa','Dive Center','Restaurant','WiFi','Butler Service'],
    featured: true,
    latitude: -8.3600, longitude: 116.0770,
  },
  {
    id: 'a0000001-0000-0000-0000-000000000003',
    name: 'Katamaran Resort', location: 'Senggigi',
    address: 'Jl. Raya Senggigi, Lombok Barat',
    price: 224, rating: 4.6, review_count: 189,
    image: 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4',
    images: ['https://images.unsplash.com/photo-1520250497591-112f2f40a3f4'],
    description: 'Katamaran Resort & Spa adalah hotel bintang 4 di kawasan Senggigi dengan pemandangan langsung ke Selat Lombok dan Gunung Agung Bali.',
    amenities: ['Pool','Spa','Restaurant','Bar','WiFi','Water Sports'],
    featured: true,
    latitude: -8.4870, longitude: 116.0430,
  },
  {
    id: 'a0000001-0000-0000-0000-000000000004',
    name: 'Puri Mas Boutique Resort', location: 'Mangsit',
    address: 'Jl. Raya Senggigi Km 7, Mangsit',
    price: 145, rating: 4.5, review_count: 143,
    image: 'https://images.unsplash.com/photo-1566073771259-6a8506099945',
    images: ['https://images.unsplash.com/photo-1566073771259-6a8506099945'],
    description: 'Puri Mas Boutique Resort adalah resort butik yang nyaman dengan nuansa Sasak yang kental, cocok untuk wisatawan yang ingin merasakan budaya lokal Lombok.',
    amenities: ['Pool','Restaurant','Cultural Activities','WiFi','Garden'],
    featured: false,
    latitude: -8.5080, longitude: 116.0510,
  },
];

const destinations = [
  {
    id: 'b0000002-0000-0000-0000-000000000001',
    name: 'Mount Rinjani', location: 'North Lombok',
    address: 'Taman Nasional Gunung Rinjani, Lombok Utara',
    price: 0, rating: 4.9, review_count: 1205,
    image: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4',
    images: ['https://images.unsplash.com/photo-1506905925346-21bda4d32df4'],
    description: 'Gunung Rinjani adalah gunung berapi aktif tertinggi kedua di Indonesia dengan ketinggian 3.726 mdpl. Danau kawah Segara Anak menawarkan pemandangan yang luar biasa indah.',
    sub_category: 'Adventure',
    latitude: -8.4110, longitude: 116.4570,
  },
  {
    id: 'b0000002-0000-0000-0000-000000000002',
    name: 'Gili Trawangan', location: 'Gili Islands',
    address: 'Kepulauan Gili, Lombok Utara',
    price: 0, rating: 4.8, review_count: 2341,
    image: 'https://images.unsplash.com/photo-1512641406448-6574e7773702',
    images: ['https://images.unsplash.com/photo-1512641406448-6574e7773702'],
    description: 'Gili Trawangan adalah pulau terbesar dari tiga Gili bersaudara. Pantai putih, air jernih, dan kehidupan bawah laut yang kaya tanpa kendaraan bermotor.',
    sub_category: 'Islands',
    latitude: -8.3496, longitude: 116.0413,
  },
  {
    id: 'b0000002-0000-0000-0000-000000000003',
    name: 'Pantai Pink', location: 'East Lombok',
    address: 'Desa Sekaroh, Jerowaru, Lombok Timur',
    price: 0, rating: 4.7, review_count: 876,
    image: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e',
    images: ['https://images.unsplash.com/photo-1507525428034-b723cf961d3e'],
    description: 'Pantai Pink atau Tangsi memiliki pasir berwarna pink kemerahan yang unik, berasal dari pecahan karang merah bercampur pasir putih.',
    sub_category: 'Beaches',
    latitude: -8.8580, longitude: 116.4790,
  },
  {
    id: 'b0000002-0000-0000-0000-000000000004',
    name: 'Desa Sade', location: 'Central Lombok',
    address: 'Desa Sade, Rembitan, Pujut, Lombok Tengah',
    price: 0, rating: 4.5, review_count: 654,
    image: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64',
    images: ['https://images.unsplash.com/photo-1558618666-fcd25c85cd64'],
    description: 'Desa Sade adalah desa tradisional suku Sasak yang masih mempertahankan adat istiadat dan arsitektur tradisional. Tersedia tenun khas Lombok.',
    sub_category: 'Culture',
    latitude: -8.8890, longitude: 116.2790,
  },
];

const restaurants = [
  {
    id: 'c0000003-0000-0000-0000-000000000001',
    name: 'Taliwang Khas Pak Udin', location: 'Mataram',
    address: 'Jl. Selaparang No. 5, Mataram',
    price: 15, rating: 4.6, review_count: 432,
    image: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4',
    images: ['https://images.unsplash.com/photo-1517248135467-4c7edcad34c4'],
    description: 'Warung makan legendaris yang menyajikan Ayam Taliwang, makanan khas Lombok dengan bumbu rempah otentik.',
    cuisine: 'Sasak Traditional', open_hours: '10:00 - 22:00',
    latitude: -8.5833, longitude: 116.1167,
  },
  {
    id: 'c0000003-0000-0000-0000-000000000002',
    name: 'Sate Rembiga Bu Ririn', location: 'Mataram',
    address: 'Jl. Rembiga, Mataram',
    price: 12, rating: 4.7, review_count: 567,
    image: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836',
    images: ['https://images.unsplash.com/photo-1504674900247-0877df9cc836'],
    description: 'Sate Rembiga khas Lombok dari daging sapi dengan bumbu kaya rempah. Salah satu yang paling terkenal di Mataram.',
    cuisine: 'Sasak Traditional', open_hours: '11:00 - 21:00',
    latitude: -8.5730, longitude: 116.1120,
  },
  {
    id: 'c0000003-0000-0000-0000-000000000003',
    name: 'Warung Menega Cafe', location: 'Senggigi',
    address: 'Jl. Raya Senggigi, Senggigi',
    price: 25, rating: 4.4, review_count: 234,
    image: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0',
    images: ['https://images.unsplash.com/photo-1414235077428-338989a2e8c0'],
    description: 'Seafood segar dengan pemandangan laut Senggigi. Menu andalan ikan bakar dan lobster dengan bumbu Sasak.',
    cuisine: 'Seafood', open_hours: '12:00 - 23:00',
    latitude: -8.4870, longitude: 116.0430,
  },
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Users
    const hashed = await bcrypt.hash('admin123', 10);
    await client.query(`
      INSERT INTO users (id, name, email, password, role, provider)
      VALUES
        ('00000000-0000-0000-0000-000000000001', 'Admin Sasacation', 'admin@sasacation.com', $1, 'admin', 'email'),
        ('00000000-0000-0000-0000-000000000002', 'Budi Santoso', 'budi@example.com', $1, 'user', 'email')
      ON CONFLICT (email) DO NOTHING
    `, [hashed]);
    console.log('✅ Users seeded');

    // Hotels
    for (const h of hotels) {
      await client.query(`
        INSERT INTO hotels (id, name, location, address, price, rating, review_count, image, images, description, amenities, featured, latitude, longitude)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (id) DO UPDATE SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude
      `, [h.id, h.name, h.location, h.address, h.price, h.rating, h.review_count, h.image, h.images, h.description, h.amenities, h.featured, h.latitude, h.longitude]);
    }
    console.log(`✅ Hotels seeded (${hotels.length})`);

    // Destinations
    for (const d of destinations) {
      await client.query(`
        INSERT INTO destinations (id, name, location, address, price, rating, review_count, image, images, description, sub_category, latitude, longitude)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (id) DO UPDATE SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude
      `, [d.id, d.name, d.location, d.address, d.price, d.rating, d.review_count, d.image, d.images, d.description, d.sub_category, d.latitude, d.longitude]);
    }
    console.log(`✅ Destinations seeded (${destinations.length})`);

    // Restaurants
    for (const r of restaurants) {
      await client.query(`
        INSERT INTO restaurants (id, name, location, address, price, rating, review_count, image, images, description, cuisine, open_hours, latitude, longitude)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (id) DO UPDATE SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude
      `, [r.id, r.name, r.location, r.address, r.price, r.rating, r.review_count, r.image, r.images, r.description, r.cuisine, r.open_hours, r.latitude, r.longitude]);
    }
    console.log(`✅ Restaurants seeded (${restaurants.length})`);

    await client.query('COMMIT');
    console.log('\n🎉 Seed selesai! Jalankan: npm run rag:index');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed gagal:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
