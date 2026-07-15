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
 * @returns {Promise<{token:string, redirect_url:string}>}
 */
async function createTransaction({ orderId, grossAmount, customer, itemName }) {
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

module.exports = { createTransaction, verifySignature, mapTransactionStatus };
