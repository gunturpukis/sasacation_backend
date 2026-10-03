// src/services/invoiceService.js
// Invoice PDF per transaksi pembayaran sukses (Fase 0).
//
// Fungsi murni: buildInvoicePdf(data) → Buffer, tanpa I/O — gampang di-test.
// Bahasa: Inggris default, Indonesia bila user_settings.language = 'id'.
// Logo: wordmark teks SASACATION (Teal #006565 + aksen Sunset #FF6B35,
// sesuai DESIGN.md) — tanpa file gambar agar deploy-proof.

const PDFDocument = require('pdfkit');

const TEAL = '#006565';
const SUNSET = '#FF6B35';
const INK = '#1b1c1c';
const GREY = '#6e7979';

// Kamus string EN/ID — satu PDF satu bahasa (tidak dwibahasa per baris).
const STR = {
  en: {
    title: 'PAYMENT INVOICE', invoiceNo: 'Invoice No', paidDate: 'Paid Date',
    bookingCode: 'Booking Code', billedTo: 'Billed To', stay: 'Stay Details',
    hotel: 'Hotel', checkIn: 'Check-in', checkOut: 'Check-out', nights: 'Nights',
    guests: 'Guests', desc: 'Description', amount: 'Amount',
    roomSubtotal: (n, r) => `Room ${r} x ${n} night(s)`,
    tax: 'Taxes (11%)', service: 'Sasa service fee', cleaning: 'Cleaning fee',
    total: 'TOTAL (USD)', method: 'Payment Method', status: 'Status',
    paid: 'PAID', policy: 'Refunds follow Sasacation Rebooking and Refund Policy.',
    redownload: 'Re-download anytime from Payment History.',
  },
  id: {
    title: 'INVOICE PEMBAYARAN', invoiceNo: 'No. Invoice', paidDate: 'Tanggal Bayar',
    bookingCode: 'Kode Booking', billedTo: 'Ditagihkan Kepada', stay: 'Detail Menginap',
    hotel: 'Hotel', checkIn: 'Check-in', checkOut: 'Check-out', nights: 'Malam',
    guests: 'Tamu', desc: 'Deskripsi', amount: 'Jumlah',
    roomSubtotal: (n, r) => `Kamar ${r} x ${n} malam`,
    tax: 'Pajak (11%)', service: 'Biaya layanan Sasa', cleaning: 'Biaya kebersihan',
    total: 'TOTAL (USD)', method: 'Metode Bayar', status: 'Status',
    paid: 'LUNAS', policy: 'Refund mengikuti Kebijakan Rebooking dan Refund Sasacation.',
    redownload: 'Unduh ulang kapan saja dari Riwayat Pembayaran.',
  },
};

function money(n) {
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d, lang) {
  return new Date(d).toLocaleDateString(lang === 'id' ? 'id-ID' : 'en-US', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

/**
 * @param {object} inv - { invoiceNo, transactionId, bookingCode, paidAt,
 *   customerName, customerEmail, hotelName, hotelLocation, checkIn, checkOut,
 *   nights, guestCount, pricePerNight, subtotal, tax, serviceFee, cleaningFee,
 *   total, method, lang: 'en'|'id' }
 * @returns {Promise<Buffer>}
 */
function buildInvoicePdf(inv) {
  const t = STR[inv.lang === 'id' ? 'id' : 'en'];
  const lang = inv.lang === 'id' ? 'id' : 'en';

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - 96;
    let y = 48;

    // ── Kop: wordmark + judul ──
    doc.font('Helvetica-Bold').fontSize(22).fillColor(TEAL).text('SASACATION', 48, y);
    doc.fillColor(SUNSET).rect(48, y + 30, 64, 4).fill();
    doc.fontSize(13).fillColor(INK).text(t.title, 48, y + 42);
    doc.font('Helvetica').fontSize(9).fillColor(GREY)
      .text(`${t.invoiceNo}: ${inv.invoiceNo}`, 48, y + 62)
      .text(`${t.paidDate}: ${fmtDate(inv.paidAt, lang)}`, 48, y + 76)
      .text(`${t.bookingCode}: ${inv.bookingCode}`, 48, y + 90);
    y += 118;

    // ── Pelanggan + ringkasan inap ──
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(t.billedTo.toUpperCase(), 48, y);
    doc.font('Helvetica').fontSize(10).text(inv.customerName, 48, y + 14).fillColor(GREY).text(inv.customerEmail, 48, y + 28);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text(t.stay.toUpperCase(), 300, y);
    doc.font('Helvetica').fontSize(10)
      .text(`${t.hotel}: ${inv.hotelName}`, 300, y + 14)
      .text(`${t.checkIn}: ${fmtDate(inv.checkIn, lang)}  •  ${t.checkOut}: ${fmtDate(inv.checkOut, lang)}`, 300, y + 28, { width: W - 252 })
      .text(`${t.nights}: ${inv.nights}  •  ${t.guests}: ${inv.guestCount}`, 300, y + 42);
    y += 72;

    // ── Tabel rincian ──
    const row = (label, val, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(INK);
      doc.text(label, 48, y, { width: W - 140 });
      doc.text(money(val), 48, y, { width: W, align: 'right' });
      y += 18;
    };
    doc.font('Helvetica-Bold').fontSize(10).fillColor(GREY);
    doc.text(t.desc.toUpperCase(), 48, y, { width: W - 140 });
    doc.text(t.amount.toUpperCase(), 48, y, { width: W, align: 'right' });
    y += 20;
    doc.strokeColor('#e5e2e1').lineWidth(1).moveTo(48, y).lineTo(48 + W, y).stroke();
    y += 10;

    row(t.roomSubtotal(inv.nights, money(inv.pricePerNight)), inv.subtotal);
    row(t.tax, inv.tax);
    row(t.service, inv.serviceFee);
    row(t.cleaning, inv.cleaningFee);
    y += 4;
    doc.strokeColor(TEAL).lineWidth(1.5).moveTo(48, y).lineTo(48 + W, y).stroke();
    y += 10;
    row(t.total, inv.total, true);

    // ── Metode + status ──
    y += 14;
    doc.font('Helvetica').fontSize(10).fillColor(GREY)
      .text(`${t.method}: ${inv.method}`, 48, y)
      .text(`${t.status}: `, 48, y + 16, { continued: true })
      .font('Helvetica-Bold').fillColor('#1B8A5A').text(t.paid);

    // ── Kaki ──
    doc.font('Helvetica').fontSize(8).fillColor(GREY)
      .text(t.policy, 48, doc.page.height - 96, { width: W })
      .text(t.redownload, 48, doc.page.height - 82, { width: W });

    doc.end();
  });
}

module.exports = { buildInvoicePdf, money };
