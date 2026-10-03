# Sprint 1 — Permintaan Backend dari Sesi Flutter (04 Okt 2026)

> Sesi Flutter mengeksekusi Sprint 1 ("Terasa Indonesia"). Dua item butuh
> tambahan backend kecil. Tulis kontrak dulu, verifikasi curl, baru Flutter
> mengonsumsi. Prioritas sesuai urutan.

## S1.1 — Kurs USD→IDR publik (P0, kecil)

Flutter butuh kurs resmi server agar seluruh harga tampil Rp.
`MIDTRANS_USD_TO_IDR_RATE` sudah dipakai server-side tapi tidak terekspos.

- `GET /forex/rate` (PUBLIK, boleh cache 1 jam) →
  ```json
  { "success": true, "data": { "usdToIdr": 16000, "updatedAt": "..." } }
  ```
- Kunci persis: `usdToIdr` (number). Flutter fallback ke mode USD bila
  endpoint gagal — tidak ada perilaku setengah-setengah di client.
- Opsional tahap 2 (bukan Sprint 1): `pricing` checkout sertakan
  `totalIdr` hasil hitung server agar angka yang ditampilkan = yang
  ditagih Midtrans (anti selisih pembulatan).

## S1.3 — Expiry booking pending (P0, kecil)

Flutter countdown "bayar dalam X" butuh expiry per booking.

- Opsi A (disarankan): `GET /bookings/my` tiap item tambah
  `expires_at` (ISO string, null bila tidak ada pembayaran aktif).
- Opsi B: biarkan Flutter panggil `GET /checkout/resume/:id` per booking
  pending (sudah diverifikasi sesi Flutter — `expiresAt` ada).
- Sesi Flutter jalan dengan Opsi B dulu; Opsi A boleh menyusul untuk
  hemat request. Beri tahu bila Opsi A live (format key: `expires_at`).

## Verifikasi sebelum serah terima (oleh BE)

1. `curl localhost:5001/api/forex/rate` → `usdToIdr` number > 0.
2. Ubah `.env` rate sementara → respons ikut berubah (bukan hardcode).
3. `GET /bookings/my` (bila Opsi A): booking pending ada `expires_at`
   valid; confirmed/cancelled boleh null.
