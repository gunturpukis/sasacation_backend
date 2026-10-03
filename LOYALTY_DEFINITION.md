# Definisi Loyalty Sasacation (Disetujui 04 Okt 2026)

> Keputusan produk: **loyalty points saja, BUKAN stored value / e-money**.
> Alasan: e-money Rupiah butuh izin Bank Indonesia — di luar jangkauan
> startup saat ini. Transfer antar user dibatasi ke **poin** (butuh endpoint
> baru, lihat §4). UI transfer rupiah yang sudah ada di aplikasi HARUS
> diubah menjadi transfer poin setelah backend siap (TODO Flutter).

## 1. Perolehan poin (sumber kebenaran: backend)

| Kejadian | Poin |
|---|---|
| Booking `completed` (checkout sukses + check-out lewat) | 1 poin per Rp10.000 dari `total_price` (IDR), dibulatkan ke bawah |
| Review hotel terkirim (bila P1 reviews + endpoint tulis ada) | 25 poin flat |
| Pendaftaran akun baru | 50 poin selamat datang |

Poin dikreditkan oleh **sistem, bukan client**: webhook Midtrans sukses
dan/atau cron yang menutup booking lewat → `INSERT loyalty_ledger`.
Jangan pernah terima penambahan poin dari request client.

## 2. Nilai & penukaran

- 100 poin = Rp10.000 diskon checkout (diterapkan sebagai `discount`
  di `pricing`, sebelum pajak — putuskan bareng pajak di sini).
- Minimal penukaran 100 poin; maksimal 50% dari subtotal per transaksi
  (lindungi margin).
- Poin kedaluwarsa 12 bulan setelah diperoleh (FIFO saat dipakai).

## 3. Tier (sudah ada di `GET /loyalty`, pertahankan ambang ini)

Bronze (default) · Silver 100+ · Gold 500+ · Platinum 2000+.
Benefit tier tahap 1 = label + prioritas CS; benefit diskon bertingkat
= scope berikutnya (jangan janjikan di UI sebelum ada).

## 4. Kontrak endpoint yang dibutuhkan (backend TODO)

- `GET /loyalty` (ADA): tambah `points_expiring_soon`, `conversion`
  `{ points_per_idr, min_redeem, max_pct }` agar Flutter tidak hardcode.
- `POST /loyalty/transfer` (BARU): `{ email, points, note? }` —
  debit+kredit atomik, validasi saldo + kelipatan 100.
- `POST /checkout/*`: terima `redeem_points` → kurangi `total`,
  catat di ledger + respons `pricing` (tampilkan baris "Diskon poin").
- `GET /loyalty/ledger` (BARU, opsional): riwayat perolehan/pakai/
  kedaluwarsa untuk layar transparansi.

## 5. Risiko & batasan eksplisit

- BUKAN e-money: tidak ada top-up rupiah, tidak ada tarik tunai, tidak
  ada transfer rupiah. Copy aplikasi dilarang memakai kata "saldo" untuk
  poin — gunakan "poin".
- Anti-fraud: rate-limit redeem, tolak redeem booking milik sendiri yang
  dibatalkan (clawback poin bila refund full).
