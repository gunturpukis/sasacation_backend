# Kontrak Backend untuk Flutter Sasacation (hasil audit UI vs Figma)

> Ditulis dari sesi opencode di repo Flutter (`sasacation`, 30 Sep 2026).
> Prinsip Flutter: **tidak ada data palsu** — semua section baru di aplikasi
> me-render data nyata atau disembunyikan. Artinya backend bisa dikerjakan
> bertahap; setiap endpoint yang live langsung tampil di aplikasi **tanpa
> perlu ubah kode Flutter**.

Konvensi umum: Flutter menoleransi `snake_case` maupun `camelCase` untuk
banyak field (lihat parser di `lib/data/model/`), tapi `snake_case`
disarankan agar konsisten dengan kolom PostgreSQL.

---

## P1 — Guest Reviews di `GET /hotels/:id` (HARUS, tanpa migration besar)

Flutter sudah render penuh (section + bottom sheet "See all") bila respons
menyertakan array ulasan. Saat ini key tidak ada → section tersembunyi.

Tambahkan ke respons detail hotel (JOIN tabel reviews atau subquery):

```json
"reviews": [
  {
    "id": "r1",
    "user_name": "Sarah Jenkins",
    "avatar": "https://...",
    "rating": 5,
    "stayed": "Jan 2024",
    "date": "2024-02-01",
    "text": "The most incredible vacation..."
  }
]
```

Key yang dibaca Flutter (`lib/data/model/hotel_model.dart` → `HotelReview.fromJson`):
- `id`, `user_name` (fallback: `userName`, `name`), `avatar` (opsional),
  `rating` (angka atau string NUMERIC — Flutter parse keduanya),
  `stayed`/`stayed_at` (opsional), `date`/`created_at` (opsional),
  `text` (fallback: `comment`, `review`). Item tanpa teks di-skip.
- Key array: `reviews` (fallback: `review_list`).

Kemungkinan file: `src/controllers/hotelsController.js` (detail),
`src/config/seedDB.js` (seed contoh). Keputusan skema (tabel `reviews`
baru vs kolom JSON) bebas — kontrak JSON di atas yang penting.

Acceptance: `GET /hotels/:id` mengembalikan `reviews[]` terisi untuk
hotel yang punya ulasan; aplikasi menampilkan "Guest Reviews" + "See all".

---

## P2 — Travel Wallet (butuh tabel + endpoint baru)

Aplikasi HANYA punya riwayat pembayaran (`PaymentHistoryScreen` dari tabel
`payments`). Saldo/poin/top-up tidak dibangun di Flutter sampai backend ada.

Kontrak yang diharapkan Flutter (belum ada kode konsumen — tulis dulu
backendnya, Flutter menyusul):

- Tabel: `wallets (user_id PK, balance_cents BIGINT DEFAULT 0)`,
  `wallet_transactions (id, user_id, amount_cents, type, label, created_at)`,
  `loyalty_points (user_id PK, points INT DEFAULT 0)` — atau kolom di users.
- `GET /wallet` → `{ balance: 12450.00, currency: "USD", sasa_points: 4820 }`
- `POST /wallet/topup` → body `{ amount }`, via Midtrans (`midtransService.js`
  sudah ada), webhook kurangi/tambah saldo + catat transaksi.
- `GET /wallet/transactions` → riwayat khusus wallet (terpisah dari
  `payments` yang bersifat per-transaksi booking).

Kemungkinan file: controller baru `walletController.js` + route
`src/routes/` + migrasi di `src/config/`.

---

## P3 — Local Impact Score (butuh flag + agregasi baru)

Layar `SustainibilityScreen` saat ini statis (disengaja). Untuk skor versi
Figma dibutuhkan:

- Flag `is_local_business` (atau tabel merchants) pada hotel/merchant.
- `GET /impact/summary` → `{ score: 842, max_score: 1000,
  level: "Guardian of Bali", local_pct: 75, corp_pct: 25,
  local_amount_idr: 2450000, certificates: [{ name, date, place }] }`
- `GET /impact/discovery` → rekomendasi anti-algoritma
  `[{ id, name, location, image, match_note }]` (bisa reuse logika
  `recommendationService.js` dengan filter "berbeda dari histori user").

---

## P4 — Saved Payment Methods di checkout (Midtrans vault)

Checkout saat ini redirect Midtrans per-transaksi. Untuk radio Visa/PayPal
tersimpan seperti mockup:

- Tokenisasi Midtrans (saved token per user) + `GET /payment-methods`
  → `[{ id, brand: "visa", last4: "4242", exp: "12/26", is_primary }]`.
- Lihat `src/config/migratePaymentGateway.js` + `midtransService.js`
  sebagai titik mulai.

---

## P5 — Travel Preferences (CEK DULU, mungkin sudah ada)

`src/controllers/preferencesController.js` + `preferenceExtractorService.js`
sudah ada. Verifikasi:

- Apakah ada endpoint GET/PUT preferensi travel user
  (gaya: relaxation/adventure/budget/gourmet)?
- Bila ya: Flutter tinggal tambah kartu preferensi di Settings
  (sesi Flutter berikutnya). Bila belum: tambahkan
  `GET /preferences` + `PUT /preferences` → `{ styles: ["adventure"] }`.

---

## P6 — Notifikasi kaya (opsional, bisa belakangan)

`notificationsController.js` + `migrateNotifications.js` sudah ada dan
aplikasi sudah render daftar + filter kategori (`payment_*` → Pembayaran,
`booking_*` → Booking) + grouping waktu. Untuk action button seperti Figma
("Reschedule", "Vote", dsb.), payload `data` notifikasi perlu field
`action: { label, route, params }` yang disepakati dengan Flutter.

---

## Endpoint yang SUDAH dipakai Flutter (jangan di-breaking)

- `POST /auth/firebase`, `GET /auth/me`, `PUT /auth/profile` (`{name?, avatar?}`),
  `PATCH /auth/location`
- `GET /hotels` (filter: `featured`, `search`, `minPrice`, `maxPrice`, `page`, `limit`),
  `GET /hotels/:id`, `GET /hotels/nearby` (`lat`, `lng`, `radius`, `limit`)
- Checkout/Midtrans, bookings, payments, wishlist, explore, recommendations,
  AI chat/planner, notifications, preferences — lihat `lib/data/repo/` di
  repo Flutter untuk key persisnya bila ragu.

## Cara verifikasi per item

1. Nyalakan backend, hit endpoint via Postman/curl, pastikan JSON sesuai
   kontrak di atas.
2. Buka aplikasi Flutter → layar terkait langsung menampilkan data baru
   (tidak perlu rebuild/CEK kode Flutter untuk P1; P2–P4 butuh layar
   Flutter baru setelah backend live).
