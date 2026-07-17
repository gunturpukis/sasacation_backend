// src/services/midtransService.js
// Wrapper tipis di atas midtrans-client — menggantikan payment simulator
// di checkoutController.js sebelumnya (yang langsung set status 'success'
// tanpa pernah menyentuh payment gateway sungguhan).
 
const midtransClient = require('midtrans-client');
const crypto = require('crypto');
 
const snap = new midtransClient.Snap({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});
 
/**
 * Buat transaksi Snap baru di Midtrans.
 * @param {object} params
 * @param {string} params.orderId - harus UNIK, kita pakai payments.transaction_id
 * @param {number} params.grossAmount - total tagihan (integer, tanpa desimal)
 * @param {{id:string, name:string, email:string}} params.customer
 * @param {string} params.itemName - deskripsi singkat untuk ditampilkan di Snap
 * @param {string[]} [params.enabledPayments] - kalau diisi 1 item, Snap skip
 *   halaman pilih metode dan langsung ke flow metode itu. Kalau tidak diisi,
 *   Snap tampilkan semua metode yang aktif di akun Midtrans (perilaku lama).
 * @returns {Promise<{token:string, redirect_url:string}>}
 */
async function createTransaction({ orderId, grossAmount, customer, itemName, enabledPayments }) {
  const parameter = {
    transaction_details: {
      order_id: orderId,
      gross_amount: Math.round(grossAmount), // Midtrans wajib integer (IDR/USD tanpa desimal)
    },
    customer_details: {
      first_name: customer.name || 'Guest',
      email: customer.email,
    },
    item_details: [
      {
        id: orderId,
        price: Math.round(grossAmount),
        quantity: 1,
        name: itemName.substring(0, 50), // Midtrans batasi max 50 karakter
      },
    ],
    // Halaman Snap otomatis expire — selaraskan dengan expiresAt yang sudah
    // ada di initiateCheckout (15 menit)
    expiry: { unit: 'minutes', duration: 15 },
    ...(enabledPayments?.length && { enabled_payments: enabledPayments }),
  };
 
  return snap.createTransaction(parameter);
}
 
/**
 * Verifikasi signature webhook Midtrans supaya tidak ada pihak lain yang bisa
 * memalsukan notifikasi "pembayaran sukses" ke server kita.
 * Formula resmi Midtrans: SHA512(order_id + status_code + gross_amount + ServerKey)
 */
function verifySignature({ orderId, statusCode, grossAmount, signatureKey }) {
  const expected = crypto
    .createHash('sha512')
    .update(`${orderId}${statusCode}${grossAmount}${process.env.MIDTRANS_SERVER_KEY}`)
    .digest('hex');
  return expected === signatureKey;
}
 
/**
 * Map transaction_status dari Midtrans ke status internal kita.
 * Referensi: https://docs.midtrans.com/docs/https-notification-webhooks
 */
function mapTransactionStatus(midtransStatus, fraudStatus) {
  if (midtransStatus === 'capture') {
    return fraudStatus === 'accept' ? 'success' : 'pending'; // fraud 'challenge' → tetap pending sampai direview
  }
  if (midtransStatus === 'settlement') return 'success';
  if (midtransStatus === 'pending') return 'pending';
  if (['deny', 'cancel', 'expire', 'failure'].includes(midtransStatus)) return 'failed';
  return 'pending';
}
 
/**
 * Petakan payment method yang dipilih user di app ke kode channel Midtrans.
 *
 * Kode-kode ini SUDAH diverifikasi lewat response resmi Midtrans Preference
 * API (bukan tebakan lagi) — percobaan pertama sempat gagal ("No payment
 * channels available") karena salah pakai kode 'qris' yang sebenarnya TIDAK
 * VALID; kode yang benar adalah 'other_qris'.
 *
 * PENTING: OVO dan DANA TIDAK punya kode channel langsung di Midtrans (beda
 * dari Xendit) — keduanya diproses lewat QRIS (user scan QR pakai app
 * OVO/DANA-nya), jadi diarahkan ke 'other_qris'.
 */
function mapToEnabledPayments(paymentMethod) {
  const map = {
    credit_card: ['credit_card'],
    bank_transfer: ['bca_va', 'bni_va', 'bri_va', 'permata_va', 'other_va', 'echannel'],
    gopay: ['gopay'],
    ovo: ['other_qris'],
    dana: ['other_qris'],
    qris: ['other_qris'],
  };
  return map[paymentMethod] || undefined; // undefined -> Snap tampilkan semua channel (fallback aman)
}
 
module.exports = { createTransaction, verifySignature, mapTransactionStatus, mapToEnabledPayments };
 