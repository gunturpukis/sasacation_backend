# Serah Terima Backend → Flutter Sasacation

> Status: **SIAP DIKERJAKAN SESI FLUTTER.** Detail kontrak per endpoint ada di
> `FLUTTER_HANDOFF.md` (F1–F16) — file ini ringkasannya: apa yang dibangun,
> apa yang berubah, dan bukti verifikasinya.
> Base URL dev: `http://localhost:5001`. Semua respons: `{ success, data }`.

## 1. Cara menjalankan backend (urutan wajib untuk DB segar)

```bash
npm install
cp .env.example .env            # lalu isi: DATABASE_URL, JWT_SECRET,
                                # MIDTRANS_*, WEATHER_API_KEY, Firebase
npm run db:init                 # skema (sudah mencakup semua tabel baru)
npm run db:seed                 # hotel, destinasi, resto, reviews, flag lokal
npm run rag:index                # embedding (butuh Ollama + nomic-embed-text)
npm test                        # 12 integration test alur uang (wajib hijau)
npm run dev                     # port 5001
```

DB lama (sudah ada isinya): jalankan semua `npm run db:migrate:*` satu per satu
(reviews, wallet, impact, payment-methods, preference-styles, booking-pending,
b4, itineraries, polls, groups, a6, tasks, invoice-snapshot) — semua idempotent.

## 2. Scope yang diserahkan (16 item, semua terverifikasi live)

| # | Fitur | Endpoint kunci | Bukti uji |
|---|-------|----------------|-----------|
| F1 | Booking `pending` + resume bayar | `GET /bookings/my`, `GET /checkout/resume/:id` | pending→409 hold→resume→confirmed |
| F2 | Discovery anti-algoritma | `GET /impact/discovery?shuffle=` (+`match_pct`) | lokal-first, acak OK |
| F3 | Search filter + sort | `GET /hotels?amenities=&sort=` | AND-semua + asc benar |
| F4 | PayPal, cleaning fee, julukan kartu | `/checkout/methods`, `pricing.*`, `PATCH /payment-methods/:id` | total 357 pas |
| F5 | Ganti password + settings | `POST /auth/change-password`, `GET/PUT /settings` | salah→401, benar→login OK |
| F6 | Itinerary tersimpan | `POST/GET/PUT/DELETE /itineraries…` | CRUD + milik-sendiri 404 |
| F7 | Vote grup | `POST /polls`, `POST /polls/:id/vote`, `/close` | pindah suara tetap 1 |
| F8 | Group budget | `POST /groups…/expenses`, summary `gap_status` | over 20% + equity ±100 |
| F9 | Transfer + travel pass | `POST /wallet/transfer`, `GET /loyalty` | dua sisi + tier Gold |
| F10 | Travel tasks | `POST/GET/PUT/PATCH/DONE/DELETE /tasks` | flight GA-421 + overdue |
| F11 | Reschedule | `PATCH /bookings/:id/reschedule` | diff +161, guard status |
| F12 | Invoice PDF + riwayat | `GET /payments`, `GET /payments/:id/invoice` | %PDF valid, 422/404 |
| F13 | Cuaca | `GET /weather?lat=&lng=` (publik) | Ubud live + alert + cache |
| F14 | Currency + rate | `GET /settings`, `pricing.fx` | USD/16000, jangan hardcode |
| F15 | Refund admin | `POST /payments/:id/refund` | guard 403/404/422/400 |
| P1–P6 | Reviews, wallet, impact, vault kartu, styles, notif action | (kontrak lama, tetap live) | smoke 21/21 |

Tambahan Fase 0: snapshot harga invoice (anti fee negatif), kategori `count/available`,
allowlist rute notifikasi 9 buah, secrets git-ignored.

## 3. Breaking changes (Flutter wajib menyesuaikan — 5 buah)

1. Booking lahir **`pending`** (dulu `confirmed`): render state Pending + "Complete Booking".
2. `pricing` + **`cleaningFee`** dan **`fx`**: tampilkan baris cleaning; kurs dari `fx`/settings.
3. Metode **`paypal`** baru di list checkout (butuh login, tetap).
4. Item payment-methods + **`label`**; item discovery + **`match_pct`** + **`meta.shuffle`**.
5. Notifikasi membawa **`data.action { label, route, params }`** — render tombol
   hanya bila ada; route valid: `booking_detail`, `hotel_detail`, `wallet`,
   `payment_methods`, `impact_summary`, `itinerary_detail`, `poll_detail`,
   `group_detail`, `task_detail`.

## 4. Bukti double-check pra-serah (tanggal tulis file ini)

- `node --check` seluruh file JS: **lolos semua**; `package.json` valid.
- Boot bersih: tanpa `❌`/error; Firebase + Postgres + Ollama + RAG OK.
- Smoke test 21 endpoint baru/berubah: **21 OK / 0 FAIL**.
- `npm test` (tests/money.test.js): **12 pass / 0 fail** (port uji 5123,
  user temporer auto-cleanup, tanpa sentuh data dev).
- Isi `FLUTTER_HANDOFF.md` dicocokkan ke kode: path, field, allowlist, 16 skrip
  migrasi — **akurat**.
- Kebersihan: tanpa server nyasar, tanpa user/data uji tersisa.
- Bug yang ditemukan & diperbaiki selama verifikasi: invoice fee negatif
  (→ snapshot harga), signature test sebelum dotenv, race assert notifikasi,
  kolom `o.created_at` tak ada, seed rusak oleh regex (diperbaiki + cek sintaks).

## 5. Batasan jujur (jangan dibuat UI-nya / sembunyikan)

- Cuaca real-time maskapai (GDS), tagihan pihak ketiga (Bills), kurs dinamis
  (masih flat 16000), currency per user, tukar poin & benefit tier, undangan grup
  via token, moderasi polls/grup, enkripsi at-rest `saved_token_id`.
- `price_diff` reschedule positif belum menagih otomatis; refund parsial tidak
  membuka tagihan baru.

## 6. Prompt siap pakai untuk sesi Flutter

> Baca `/Users/Guntur/Downloads/Project Sasacat/Final Sasacation/sasacation-backend/FLUTTER_HANDOFF.md`
> dan `FLUTTER_SERAH_TERIMA.md` di folder yang sama. Kerjakan mulai dari F1.
> Aturan: tidak ada data palsu (sembunyikan section bila API kosong/404),
> kurs hanya dari kontrak F14, kategori hanya yang `available: true`.
> Verifikasi tiap item dengan curl sebelum lanjut.
