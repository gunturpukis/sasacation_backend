// src/config/firebase.js
// Inisialisasi Firebase Admin SDK.
// Dipakai untuk:
//   1. Verifikasi ID token dari Firebase Auth (login Google/Apple/Email di app)
//   2. Mengirim push notification lewat Firebase Cloud Messaging (FCM)
//
// Credential diambil dari salah satu:
//   - FIREBASE_SERVICE_ACCOUNT_JSON (isi JSON service account sebagai string, dipakai saat deploy)
//   - FIREBASE_SERVICE_ACCOUNT_PATH (path ke file JSON, dipakai untuk lokal)
//
// Kalau keduanya tidak ada, admin SDK sengaja TIDAK di-init supaya server tetap
// bisa jalan untuk fitur lain (hotels, explore, dst) — hanya endpoint yang
// butuh Firebase yang akan menolak request dengan pesan jelas.

const admin = require('firebase-admin');

let app = null;
let initError = null;

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    return require(require('path').resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH));
  }
  return null;
}

try {
  const serviceAccount = loadServiceAccount();
  if (serviceAccount) {
    app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('✅ Firebase Admin SDK aktif (Auth + FCM siap dipakai)');
  } else {
    console.warn('⚠️  Firebase Admin SDK TIDAK di-init — FIREBASE_SERVICE_ACCOUNT_PATH/JSON belum diisi di .env');
    console.warn('   Endpoint /api/auth/firebase dan /api/notifications/* akan menolak request.');
  }
} catch (err) {
  initError = err;
  console.error('❌ Gagal inisialisasi Firebase Admin SDK:', err.message);
}

function isFirebaseReady() {
  return app !== null;
}

function requireFirebase() {
  if (!isFirebaseReady()) {
    const reason = initError ? initError.message : 'Kredensial Firebase belum dikonfigurasi';
    const err = new Error(`Firebase Admin belum siap: ${reason}`);
    err.code = 'FIREBASE_NOT_READY';
    throw err;
  }
}

module.exports = {
  admin,
  isFirebaseReady,
  requireFirebase,
};
