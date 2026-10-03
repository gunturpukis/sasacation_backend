# FLUTTER HANDOFF — Backend Siap Dikonsumsi (Batch Figma Audit)

> Ditulis oleh sesi backend. Cara pakai di sesi Flutter: kerjakan per item,
> verifikasi dengan curl di bawah, centang Status. Semua respons dibungkus
> `{ success, data }` kecuali dinyatakan lain. Base URL dev: `http://localhost:5001`.
> Auth: `Authorization: Bearer <JWT>` kecuali dinyatakan publik.

## ⚠️ Perubahan perilaku lama (wajib baca dulu)

1. **Booking kini lahir `pending`** (dulu langsung `confirmed`). `GET /bookings/my`
   bisa kembalikan `status: pending` → My Trips WAJIB render state
   Pending/Action Required + tombol "Complete Booking" → `GET /api/checkout/resume/:bookingId`
   (balas `redirectUrl` Snap aktif; 404 = tidak ada pembayaran aktif → arahkan ke `/pay` ulang).
   Webhook sukses → `confirmed`; gagal/expired → `cancelled`.
2. **Pricing checkout + `cleaningFee`.** `POST /api/checkout/initiate` →
   `pricing: { pricePerNight, subtotal, tax, taxRate, serviceFee, cleaningFee, total, currency }`.
   Tampilkan baris "Cleaning fee" di Price Summary.
3. **`GET /api/checkout/methods` + `paypal`.** Butuh login (tetap).
4. **`GET /api/payment-methods[]` + `label`** (julukan, nullable) dan
   `GET /api/impact/discovery[]` + `match_pct` + `meta: { shuffle }`.
5. **Notifikasi `data.action`** → `{ label, route, params }`. Route valid:
   `booking_detail{bookingId}`, `hotel_detail{hotelId}`, `wallet{}`,
   `payment_methods{}`, `impact_summary{}`, `itinerary_detail{itineraryId}`,
   `poll_detail{pollId}`, `group_detail{groupId}`, `task_detail{taskId}`.
   Render tombol hanya bila `action` ada.

## Item siap (backend live, terverifikasi)

### F1 — My Trips: status Pending + Complete Booking [siap]
- `GET /api/bookings/my` → tiap booking kini ada `status: pending|confirmed|cancelled|completed`
  + `payment: { transactionId, method, status, paidAt }`.
- `GET /api/checkout/resume/:bookingId` → `{ transactionId, bookingCode, bookingStatus,
  method, amount, snapToken, redirectUrl, expiresAt }` (404 bila tak ada yang aktif).
- Kriteria: booking pending tampil + tombol buka `redirectUrl`; sukses bayar → `confirmed`.

### F2 — Discovery: match_pct + Shuffle [siap]
- `GET /api/impact/discovery?limit=&shuffle=` (publik, auth opsional) → tiap item
  `{ id, name, location, image, match_pct: 0, match_note }` + `meta: { shuffle }`.
- Tombol "Guncang untuk Temukan" → panggil dengan `shuffle=true`.
- Kriteria: tampil "0% Match with Your History" dari `match_pct`.

### F3 — Search: filter amenities + sort [siap]
- `GET /api/hotels?amenities=Spa,Pool&sort=` — `sort: rating|price_asc|price_desc|newest`
  (salah → 400). `amenities` koma = cocok SEMUA.
- Kriteria: chip Price/Rating/Popularity/Amenities memanggil param ini.

### F4 — Checkout: PayPal + cleaning fee + kartu bernama [siap]
- Metode `paypal` ada di list; `pricing.cleaningFee` tampil di rincian.
- `GET /api/payment-methods` → `{ id, brand, last4, exp, is_primary, label }`;
  `PATCH /api/payment-methods/:id` body `{ label }` (ganti julukan "Business").
- Kriteria: radio VISA/PayPal tersimpan + "Add New" → `/pay` dengan `saveCard: true`
  (khusus `credit_card`) memunculkan toggle save di Snap.

### F5 — Settings: ganti password + toggle [siap]
- `POST /api/auth/change-password` body `{ currentPassword, newPassword }` (min 8).
- `GET/PUT /api/settings` → `{ push_enabled, ai_personalization, language: en|id }`
  (PUT parsial).
- Kriteria: switch Push/Personalization/Language tersimpan ke server.

### F6 — Itinerary tersimpan [siap]
- `POST /api/itineraries` `{ title, destination?, start_date?, end_date?, status?, items?[] }`
  (`item: { day, time?, title, description?, location?, kind: activity|meal|rest|transport|stay }`).
- `GET /api/itineraries/my` (ada `item_count`), `GET/PUT/DELETE /api/itineraries/:id`,
  `POST /api/itineraries/:id/items` ("Add to Itinerary"),
  `PATCH/DELETE /api/itineraries/items/:itemId`.
- Kriteria: hasil trip-plan bisa disimpan + dibuka dari nav Itinerary + "View Itinerary".

### F7 — Vote grup [siap]
- `POST /api/polls` `{ title, options[2..10], description?, closes_at? }` →
  `{ is_open, total_votes, my_option_id, options: [{ id, label, votes, pct }] }`.
- `GET /api/polls/open|my|:id`, `POST /api/polls/:id/vote` `{ optionId }` (pindah = ganti),
  `PATCH /:id/close`, `DELETE /:id` (khusus pembuat).
- Kriteria: kartu "New Vote" + tombol "Vote now" → buka `poll_detail{pollId}`.

### F8 — Group Budget [siap]
- `POST /api/groups` `{ name, destination?, budget_total?, currency? }` (pembuat auto-anggota).
- `GET /api/groups/my|:id` → `{ budget_total, total_spent, remaining, member_count,
  members: [{ user_id, name, avatar, paid, fair_share, balance }], expenses,
  gap_status: none|under|near|over, pct_over }`.
- `POST /:id/members` `{ email }`, `DELETE /:id/members/:userId`,
  `POST /:id/expenses` `{ label, amount, category?, spent_at? }`,
  `DELETE /:id/expenses/:expenseId`, `DELETE /:id` (owner).
- Kriteria: kartu "Spending Gap Detected …% above" tampil bila `gap_status: over`
  (pakai `pct_over`); "View Suggestions" → `group_detail{groupId}`.

### F9 — Wallet Transfer + Travel Pass [siap]
- `POST /api/wallet/transfer` `{ email, amount, note? }` → debit+kredit atomik.
- `GET /api/loyalty` → `{ pass_id, points, tier: Bronze|Silver|Gold|Platinum, trips_completed, member_since }`.
  Tier: Silver 100+, Gold 500+, Platinum 2000+.
- Kriteria: tombol Transfer + kartu Travel Pass render dari endpoint ini
  (tanpa nomor kartu palsu — `pass_id` sebagai ID member).

### F10 — Travel Tasks [siap]
- `POST /api/tasks` `{ title, kind: flight_checkin|reminder|payment|document|other,
  booking_id?, detail?, due_at?, payload? }` (payload mis. `{ flight_no, seats }`).
- `GET /api/tasks/my?done=&upcoming=` (+ `meta: { total, overdue }`),
  `PUT /:id`, `PATCH /:id/done` `{ done }`, `DELETE /:id`.
- Kriteria: kartu "Check-in Open GA-421 … Seats" dari task `flight_checkin`.

### F11 — Reschedule Booking [siap]
- `PATCH /api/bookings/:id/reschedule` `{ checkIn, checkOut }` (hanya `confirmed`,
  cek bentrok) → `{ booking, old_total, new_total, price_diff }`.
  `price_diff > 0` = perlu bayar tambahan (belum otomatis).
- Kriteria: tombol "Reschedule" → endpoint ini → tampilkan selisih.

### F12 — Invoice PDF + riwayat pembayaran [siap]
- `GET /api/payments` (riwayat, `{ data, totalSpent }`) — endpoint ini sempat
  tidak aktif, sekarang live.
- `GET /api/payments/:transactionId/invoice` → unduh PDF
  (`Content-Disposition: attachment`), pemilik/admin saja, hanya `status success`
  (pending → 422, asing/tak ada → 404). Bahasa ikut `user_settings.language`.
- Kriteria: tombol "Unduh Invoice" di tiap baris sukses Payment History.

### F13 — Cuaca destinasi [siap — key aktif, terverifikasi live]
- `GET /api/weather?lat=&lng=` (publik) → `{ current: { temp_c, feels_like_c,
  humidity, condition, description, icon, wind_ms, location, observed_at },
  alert: { severity: high|medium, kind: thunderstorm|heavy_rain, title, window } | null,
  cached }`. Cache 10 menit.
- `alert != null` → tampilkan kartu "Destination Alert" + tombol Reschedule
  (`PATCH /api/bookings/:id/reschedule`). `alert == null` → sembunyikan kartu.

### F14 — Kontrak currency + rate (prasyarat S1.1) [siap]
- `GET /api/settings` → `currency: "USD"`, `usd_to_idr_rate: 16000` (global,
  dari env `DEFAULT_CURRENCY` / `MIDTRANS_USD_TO_IDR_RATE`).
- `POST /api/checkout/initiate` → `pricing.fx: { currency, usd_to_idr_rate }`.
- Aturan: semua harga API dalam `currency`; Flutter JANGAN hardcode kurs —
  baca dari kontrak ini. Per-user currency = scope berikutnya.

### F15 — Refund (admin/backoffice) [siap]
- `POST /api/payments/:transactionId/refund` (admin only)
  body `{ amount? (USD, default full), reason? }` → full = booking ikut
  `cancelled`; parsial = booking tetap. Gagal gateway = 502 tanpa ubah DB.
  Notif `payment_refunded` terkirim ke user.
- Kriteria: layar admin/support memanggil ini; app user cukup tampilkan
  status `refunded` dari riwayat (tidak ada aksi user).

### F16 — Taksonomi kategori + secrets [siap]
- `GET /api/explore/categories[]` kini membawa `count` + `available`
  (dari isi DB). **Sembunyikan chip dengan `available: false`.**
  Pemetaan chip Figma: Beach→`beaches`, Mountain→`adventure`,
  City→`culture`, sisanya 1:1 (`hotels`, `culinary`, `islands`).
- Konvensi bahasa respons: error validasi Indonesia, konten user apa adanya,
  invoice ikut `user_settings.language`. Dwibahasa penuh = scope berikutnya.
- Secrets (`.env`, `firebase-service-account.json`) terkonfirmasi git-ignored
  dan tidak terlacak — jangan pernah commit; `WEATHER_API_KEY` hanya di `.env`.

## Item BLOCKED (jangan dibuat UI-nya dulu / sembunyikan)
- **B1 Cuaca** ("Weather Update: Bali", badai Ubud): butuh API key cuaca
  (mis. OpenWeather) di `WEATHER_API_KEY` — belum ada. Backend belum bangun.
- **B2 Penerbangan real-time** (status/ketersediaan kursi maskapai): butuh integrasi
  GDS — belum ada. Task penerbangan saat ini data manual via `POST /api/tasks`.
- **B3 Bills/Tagihan pihak ketiga** di wallet: belum ada.

## Cara verifikasi per item (tanpa build ulang backend)
1. Backend dev jalan (`npm run dev`, port 5001). Login → JWT:
   `curl -X POST localhost:5001/api/auth/login -d '{"email":"budi@example.com","password":"admin123"}'`.
2. Panggil endpoint item, cocokkan JSON dengan kontrak di atas.
3. UI langsung bisa render — tidak perlu perubahan backend lagi untuk F1–F16.
4. Alur uang terproteksi `npm test` (12 integration test hijau:
   checkout, webhook, wallet, transfer, refund guards, invoice).
