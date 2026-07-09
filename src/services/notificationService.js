// src/services/notificationService.js
// Wrapper tipis di atas Firebase Admin Messaging untuk mengirim push
// notification. Dipakai oleh notificationsController (endpoint test/broadcast)
// dan bisa dipanggil dari controller lain nanti (mis. saat booking dikonfirmasi).

const { admin, requireFirebase } = require('../config/firebase');

/**
 * Kirim notifikasi ke satu device token.
 * @param {string} token - FCM registration token milik device.
 * @param {{title:string, body:string}} notification
 * @param {Record<string,string>} [data] - payload tambahan (opsional), semua value harus string.
 */
async function sendToToken(token, notification, data = {}) {
  requireFirebase();
  if (!token) throw new Error('FCM token kosong');

  const message = {
    token,
    notification,
    data,
    android: {
      priority: 'high',
      notification: { channelId: 'sasacation_default', sound: 'default' },
    },
    apns: {
      payload: { aps: { sound: 'default', 'content-available': 1 } },
    },
  };

  return admin.messaging().send(message);
}

/**
 * Kirim notifikasi ke banyak token sekaligus (maks 500 per panggilan sesuai limit FCM).
 * Mengembalikan ringkasan sukses/gagal per token supaya token yang sudah tidak
 * valid (uninstalled/expired) bisa dibersihkan oleh pemanggil.
 */
async function sendToTokens(tokens, notification, data = {}) {
  requireFirebase();
  const validTokens = (tokens || []).filter(Boolean);
  if (validTokens.length === 0) return { successCount: 0, failureCount: 0, invalidTokens: [] };

  const message = {
    tokens: validTokens,
    notification,
    data,
    android: { priority: 'high', notification: { channelId: 'sasacation_default', sound: 'default' } },
    apns: { payload: { aps: { sound: 'default', 'content-available': 1 } } },
  };

  const response = await admin.messaging().sendEachForMulticast(message);
  const invalidTokens = [];
  response.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error?.code || '';
      if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) {
        invalidTokens.push(validTokens[i]);
      }
    }
  });

  return { successCount: response.successCount, failureCount: response.failureCount, invalidTokens };
}

/** Kirim notifikasi ke topic (mis. 'promo', 'all-users'). */
async function sendToTopic(topic, notification, data = {}) {
  requireFirebase();
  return admin.messaging().send({ topic, notification, data });
}

module.exports = { sendToToken, sendToTokens, sendToTopic };
