// src/config/migrateInvoiceSnapshot.js
// Migrasi pendamping invoice PDF (Fase 0).
//
// Temuan verifikasi: invoice merekonstruksi rincian dari tarif hotel SAAT INI,
// sehingga booking lama (dibayar sebelum kolom cleaning_fee ada) menghasilkan
// service fee NEGATIF di invoice. Snapshot komponen harga saat /pay adalah
// perbaikan yang benar — invoice wajib mencerminkan yang DITAGIHKAN, bukan
// tarif terkini. Baris lama (kolom NULL) pakai fallback heuristik di controller.

require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔧 Menjalankan migrasi Invoice Snapshot...\n');
    await client.query('BEGIN');

    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS tax_amount NUMERIC`);
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS service_fee NUMERIC`);
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS cleaning_fee NUMERIC`);
    console.log('✅ Kolom tax_amount/service_fee/cleaning_fee di payments');

    await client.query('COMMIT');
    console.log('\n🎉 Migrasi invoice snapshot selesai.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migrasi gagal:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
