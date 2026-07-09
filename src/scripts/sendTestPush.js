#!/usr/bin/env node
// src/scripts/sendTestPush.js
//
// CLI kecil untuk uji coba push notification langsung dari terminal, tanpa
// perlu server Express berjalan dan tanpa perlu login/JWT. Berguna untuk
// memverifikasi cepat apakah kredensial Firebase Admin SDK dan FCM device
// token sudah benar.
//
// Pemakaian:
//   npm run push:test -- <fcm_token> ["Judul"] ["Isi pesan"]
//
// Contoh:
//   npm run push:test -- dEf456...xyz "Halo" "Test dari CLI"

require('dotenv').config();
const { sendToToken } = require('../services/notificationService');
const { isFirebaseReady } = require('../config/firebase');

async function main() {
  const [token, title, body] = process.argv.slice(2);

  if (!isFirebaseReady()) {
    console.error('❌ Firebase Admin belum dikonfigurasi. Isi FIREBASE_SERVICE_ACCOUNT_PATH atau FIREBASE_SERVICE_ACCOUNT_JSON di .env terlebih dahulu.');
    process.exit(1);
  }

  if (!token) {
    console.error('❌ FCM device token wajib diisi.');
    console.error('   Pemakaian: npm run push:test -- <fcm_token> ["Judul"] ["Isi pesan"]');
    process.exit(1);
  }

  try {
    const messageId = await sendToToken(
      token,
      { title: title || 'Test Notifikasi Sasacation', body: body || 'Ini pesan test push notification dari CLI 🌴' }
    );
    console.log('✅ Push notification terkirim!');
    console.log('   Message ID:', messageId);
  } catch (err) {
    console.error('❌ Gagal mengirim push notification:', err.message);
    process.exit(1);
  }
}

main();
