// // src/services/notificationService.js
// // Wrapper tipis di atas Firebase Admin Messaging untuk mengirim push
// // notification. Dipakai oleh notificationsController (endpoint test/broadcast)
// // dan bisa dipanggil dari controller lain nanti (mis. saat booking dikonfirmasi).

// const { admin, requireFirebase } = require('../config/firebase');

// /**
//  * Kirim notifikasi ke satu device token.
//  * @param {string} token - FCM registration token milik device.
//  * @param {{title:string, body:string}} notification
//  * @param {Record<string,string>} [data] - payload tambahan (opsional), semua value harus string.
//  */
// async function sendToToken(token, notification, data = {}) {
//   requireFirebase();
//   if (!token) throw new Error('FCM token kosong');

//   const message = {
//     token,
//     notification,
//     data,
//     android: {
//       priority: 'high',
//       notification: { channelId: 'sasacation_default', sound: 'default' },
//     },
//     apns: {
//       payload: { aps: { sound: 'default', 'content-available': 1 } },
//     },
//   };

//   return admin.messaging().send(message);
// }

// /**
//  * Kirim notifikasi ke banyak token sekaligus (maks 500 per panggilan sesuai limit FCM).
//  * Mengembalikan ringkasan sukses/gagal per token supaya token yang sudah tidak
//  * valid (uninstalled/expired) bisa dibersihkan oleh pemanggil.
//  */
// async function sendToTokens(tokens, notification, data = {}) {
//   requireFirebase();
//   const validTokens = (tokens || []).filter(Boolean);
//   if (validTokens.length === 0) return { successCount: 0, failureCount: 0, invalidTokens: [] };

//   const message = {
//     tokens: validTokens,
//     notification,
//     data,
//     android: { priority: 'high', notification: { channelId: 'sasacation_default', sound: 'default' } },
//     apns: { payload: { aps: { sound: 'default', 'content-available': 1 } } },
//   };

//   const response = await admin.messaging().sendEachForMulticast(message);
//   const invalidTokens = [];
//   response.responses.forEach((r, i) => {
//     if (!r.success) {
//       const code = r.error?.code || '';
//       if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) {
//         invalidTokens.push(validTokens[i]);
//       }
//     }
//   });

//   return { successCount: response.successCount, failureCount: response.failureCount, invalidTokens };
// }

// /** Kirim notifikasi ke topic (mis. 'promo', 'all-users'). */
// async function sendToTopic(topic, notification, data = {}) {
//   requireFirebase();
//   return admin.messaging().send({ topic, notification, data });
// }

// module.exports = { sendToToken, sendToTokens, sendToTopic };


// src/services/notificationService.js
// Wrapper tipis di atas Firebase Admin Messaging untuk mengirim push
// notification. Dipakai oleh notificationsController (endpoint test/broadcast)
// dan bisa dipanggil dari controller lain nanti (mis. saat booking dikonfirmasi).

const { messaging, requireFirebase } = require('../config/firebase');
const pool = require('../config/db');
 
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

  return messaging().send(message);
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

  const response = await messaging().sendEachForMulticast(message);
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
  return messaging().send({ topic, notification, data });
}
 
/**
 * Simpan notifikasi ke riwayat in-app (tabel `notifications`) — dipanggil
 * TERPISAH dari pengiriman push, supaya riwayat tetap tersimpan walau push
 * gagal terkirim (device offline, token expired, dll). Push itu "instant
 * alert", riwayat ini yang jadi sumber kebenaran untuk Notifications screen.
 */
async function persistNotification(userId, { title, body, type = 'general', data = {} }) {
  await pool.query(
    `INSERT INTO notifications (user_id, title, body, type, data) VALUES ($1, $2, $3, $4, $5)`,
    [userId, title, body, type, JSON.stringify(data)]
  );
}

// ─── P6 (FLUTTER_P3_CONTRACTS.md): Action button Figma ──────────────────────
// Kontrak `data.action` yang disepakati dengan Flutter:
//   action: { label: "Lihat Booking", route: "booking_detail", params: { bookingId: "..." } }
// Flutter render tombol bila `action` ada; tap → navigasi internal sesuai
// `route` + `params`. Daftar route yang BOLEH dipakai backend (allowlist) —
// Flutter wajib implementasikan mapping untuk SEMUA key ini:
//   - booking_detail  { bookingId }   → detail booking
//   - hotel_detail    { hotelId }     → detail hotel
//   - wallet          {}              → Travel Wallet
//   - payment_methods {}              → metode tersimpan
//   - impact_summary  {}              → skor Local Impact
const NOTIFICATION_ROUTES = {
  booking_detail: ['bookingId'],
  hotel_detail: ['hotelId'],
  wallet: [],
  payment_methods: [],
  impact_summary: [],
  // A5: tombol "View Itinerary".
  itinerary_detail: ['itineraryId'],
  // A1: tombol "Vote now".
  poll_detail: ['pollId'],
  // A2: tombol "View Suggestions" kartu budget.
  group_detail: ['groupId'],
  // A3: tombol aksi kartu travel task.
  task_detail: ['taskId'],
};

/**
 * Bangun action notifikasi yang valid. Throw untuk route/param tak dikenal
 * (programmer error — harus ketahuan saat develop, bukan saat user tap).
 */
function buildAction(label, route, params = {}) {
  if (typeof label !== 'string' || !label.trim()) {
    throw new Error('action label wajib string tidak kosong');
  }
  const required = NOTIFICATION_ROUTES[route];
  if (!required) {
    throw new Error(`action route tak dikenal: ${route}. Pilih dari: ${Object.keys(NOTIFICATION_ROUTES).join(', ')}`);
  }
  const missing = required.filter(k => params[k] === undefined || params[k] === null || params[k] === '');
  if (missing.length > 0) {
    throw new Error(`action route ${route} butuh params: ${missing.join(', ')}`);
  }
  const safeParams = {};
  for (const [k, v] of Object.entries(params)) safeParams[k] = String(v);
  return { label: label.trim(), route, params: safeParams };
}

/**
 * FCM hanya menerima string di payload `data` — objek (mis. action) harus
 * di-JSON-kan dulu. Riwayat DB tetap menyimpan objek aslinya (lihat
 * persistNotification), flatten ini HANYA untuk push.
 */
function flattenDataForFcm(data = {}) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}
 
/**
 * Helper gabungan: persist ke riwayat DULU (supaya tetap ada walau push
 * gagal), baru coba kirim push. Dipakai di titik-titik notifikasi NYATA
 * (mis. pembayaran sukses) — BUKAN untuk endpoint /notifications/test yang
 * memang cuma untuk uji coba FCM, sengaja tidak ikut mengotori riwayat user.
 */
async function notifyUser(userId, token, notification, data = {}) {
  await persistNotification(userId, { ...notification, type: data.type || 'general', data });
  if (token) {
    try {
      await sendToToken(token, notification, flattenDataForFcm(data));
    } catch (e) {
      // Push gagal (token invalid/expired dll) tidak boleh menggagalkan alur
      // utama (mis. konfirmasi pembayaran) — riwayat in-app sudah tersimpan,
      // user tetap bisa lihat notifikasinya lewat Notifications screen.
      console.error('[notifyUser] Push gagal terkirim (diabaikan):', e.message);
    }
  }
}

module.exports = { sendToToken, sendToTokens, sendToTopic, persistNotification, notifyUser, buildAction, flattenDataForFcm, NOTIFICATION_ROUTES };