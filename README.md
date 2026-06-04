# 🌴 Sasacation Backend API

Backend REST API untuk aplikasi wisata Lombok **Sasacation**, dibangun dengan **Node.js + Express**.

---

## 🚀 Cara Menjalankan

### 1. Masuk ke folder backend
```bash
cd sasacation-backend
```

### 2. Install dependencies
```bash
npm install
```

### 3. Setup environment variables
```bash
cp .env.example .env
# Edit .env jika perlu (PORT, JWT_SECRET, dll)
```

### 4. Jalankan server
```bash
# Mode development (auto-restart)
npm run dev

# Mode production
npm start
```

Server berjalan di: **http://localhost:3000**

---

## 🔑 Akun Default

| Role  | Email                    | Password  |
|-------|--------------------------|-----------|
| Admin | admin@sasacation.com     | admin123  |
| User  | budi@example.com         | admin123  |

---

## 📋 API Endpoints

### Auth
| Method | Endpoint            | Auth | Deskripsi              |
|--------|---------------------|------|------------------------|
| POST   | `/api/auth/register`| ❌   | Daftar user baru       |
| POST   | `/api/auth/login`   | ❌   | Login                  |
| GET    | `/api/auth/me`      | ✅   | Profile user aktif     |
| PUT    | `/api/auth/profile` | ✅   | Update nama/avatar     |

**Contoh Login:**
```json
POST /api/auth/login
{
  "email": "admin@sasacation.com",
  "password": "admin123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": { "id": "user-1", "name": "Admin Sasacation", ... }
  }
}
```

---

### Hotels
| Method | Endpoint        | Auth  | Deskripsi           |
|--------|-----------------|-------|---------------------|
| GET    | `/api/hotels`   | ❌    | List hotel          |
| GET    | `/api/hotels/:id` | ❌  | Detail hotel        |
| POST   | `/api/hotels`   | Admin | Tambah hotel        |
| PUT    | `/api/hotels/:id` | Admin | Edit hotel        |
| DELETE | `/api/hotels/:id` | Admin | Hapus hotel       |

**Query params GET /api/hotels:**
- `featured=true` — hanya hotel featured
- `search=senggigi` — search by nama/lokasi
- `minPrice=100&maxPrice=300` — filter harga
- `page=1&limit=10` — paginasi

---

### Explore
| Method | Endpoint                     | Deskripsi              |
|--------|------------------------------|------------------------|
| GET    | `/api/explore`               | Semua item wisata      |
| GET    | `/api/explore/categories`    | List kategori          |
| GET    | `/api/explore/destinations`  | Destinasi wisata       |
| GET    | `/api/explore/destinations/:id` | Detail destinasi   |
| GET    | `/api/explore/restaurants`   | Restoran               |
| GET    | `/api/explore/restaurants/:id` | Detail restoran      |

**Query params GET /api/explore:**
- `category=hotels|beaches|islands|adventure|culture|culinary`
- `search=gili`

---

### Bookings
| Method | Endpoint                  | Auth  | Deskripsi           |
|--------|---------------------------|-------|---------------------|
| POST   | `/api/bookings`           | ✅    | Buat booking baru   |
| GET    | `/api/bookings/my`        | ✅    | Booking saya        |
| GET    | `/api/bookings/:id`       | ✅    | Detail booking      |
| PATCH  | `/api/bookings/:id/cancel`| ✅    | Batalkan booking    |
| GET    | `/api/bookings`           | Admin | Semua booking       |

**Contoh Buat Booking:**
```json
POST /api/bookings
Authorization: Bearer <token>

{
  "hotelId": "1",
  "checkIn": "2024-06-10T00:00:00.000Z",
  "checkOut": "2024-06-13T00:00:00.000Z",
  "guestCount": 2,
  "notes": "Minta kamar yang menghadap laut"
}
```

---

## 🔒 Autentikasi

Untuk endpoint yang butuh auth, sertakan token di header:
```
Authorization: Bearer <token>
```

---

## 📱 Koneksi dari Flutter

Edit `lib/data/api/api_client.dart`, pilih `baseUrl` sesuai environment:

```dart
// Android Emulator
static const String baseUrl = 'http://10.0.2.2:3000/api';

// iOS Simulator  
static const String baseUrl = 'http://localhost:3000/api';

// Physical Device (ganti dengan IP komputer kamu)
static const String baseUrl = 'http://192.168.1.x:3000/api';
```

---

## 📦 Struktur Project

```
sasacation-backend/
├── src/
│   ├── config/
│   │   └── database.js          # In-memory database + seed data
│   ├── middleware/
│   │   └── auth.js              # JWT auth & admin guard
│   ├── controllers/
│   │   ├── authController.js    # Register, login, profile
│   │   ├── hotelsController.js  # CRUD hotels
│   │   ├── exploreController.js # Destinations, restaurants
│   │   └── bookingsController.js # Booking system
│   ├── routes/
│   │   ├── auth.js
│   │   ├── hotels.js
│   │   ├── explore.js
│   │   └── bookings.js
│   └── index.js                 # Entry point
├── .env
├── .env.example
└── package.json
```

---

## 🗄️ Catatan Database

Saat ini menggunakan **in-memory database** (data hilang saat server restart).

Untuk production, disarankan migrasi ke:
- **PostgreSQL** + Prisma ORM
- **MongoDB** + Mongoose
- **MySQL** + Sequelize

---

## 🛠️ Tech Stack

- **Runtime:** Node.js 18+
- **Framework:** Express.js
- **Auth:** JWT (jsonwebtoken) + bcryptjs
- **Dev:** nodemon
