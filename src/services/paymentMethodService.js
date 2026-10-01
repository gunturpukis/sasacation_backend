// src/services/paymentMethodService.js
// P4 (FLUTTER_P3_CONTRACTS.md): logika vault kartu Midtrans.
//
// Dipakai dua tempat: checkoutController (capture otomatis saat webhook sukses)
// dan paymentMethodsController (format API). Token mentah tidak pernah keluar
// dari service ini ke response HTTP.

/**
 * Tebak brand dari BIN (digit awal masked_card). Hanya brand yang didukung
 * CHECK constraint payment_methods.brand; sisanya 'unknown' (tetap disimpan,
 * last4-nya yang penting untuk dikenali user).
 */
function brandFromBin(bin) {
  if (/^3[47]/.test(bin)) return 'amex';
  if (/^35/.test(bin)) return 'jcb';
  if (/^4/.test(bin)) return 'visa';
  if (/^5/.test(bin)) return 'mastercard';
  return 'unknown';
}

/**
 * Parse masked_card Midtrans ("48111111-1114" format BIN 8-digit baru atau
 * "481111-1114" format lama). Return null kalau format tidak dikenali —
 * caller harus skip capture (jangan gagalkan webhook karenanya).
 */
function parseMaskedCard(maskedCard) {
  if (typeof maskedCard !== 'string') return null;
  const m = maskedCard.trim().match(/^(\d{6,8})-(\d{4})$/);
  if (!m) return null;
  return { bin: m[1], last4: m[2], brand: brandFromBin(m[1]) };
}

/**
 * Parse saved_token_id_expired_at ("2024-08-25 11:21:48" — menurut dok
 * Midtrans ini tanggal kedaluwarsa KARTU). Return {month, year} atau null.
 */
function parseCardExpiry(expiredAt) {
  if (typeof expiredAt !== 'string') return null;
  const m = expiredAt.trim().match(/^(\d{4})-(\d{2})-\d{2}/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { month, year };
}

/**
 * Simpan kartu dari payload webhook Midtrans yang sukses. Idempotent:
 * kartu yang sama (brand+last4+exp) hanya update tokennya, tidak dobel baris.
 * Kartu pertama user otomatis jadi primary. Return row, atau null bila
 * payload bukan kartu tersimpan / format tak dikenali. TIDAK PERNAH throw
 * untuk data tak dikenali — webhook pembayaran lebih penting dari capture.
 */
async function captureSavedCard(db, userId, body) {
  try {
    if (body?.payment_type !== 'credit_card') return null;
    if (!body.saved_token_id) return null; // user tidak centang "save card"
    const parsed = parseMaskedCard(body.masked_card);
    if (!parsed) {
      console.warn('[vault] masked_card tak dikenali, skip capture:', body.masked_card);
      return null;
    }
    const exp = parseCardExpiry(body.saved_token_id_expired_at);

    const { rows: existing } = await db.query(
      `SELECT id FROM payment_methods
       WHERE user_id = $1 AND brand = $2 AND last4 = $3
         AND COALESCE(exp_month, -1) = COALESCE($4, -1)
         AND COALESCE(exp_year, -1) = COALESCE($5, -1)`,
      [userId, parsed.brand, parsed.last4, exp?.month ?? null, exp?.year ?? null]
    );
    if (existing.length > 0) {
      const { rows } = await db.query(
        `UPDATE payment_methods
         SET saved_token_id = $1, token_expires_at = $2
         WHERE id = $3 RETURNING id, brand, last4, exp_month, exp_year, is_primary, created_at`,
        [body.saved_token_id, body.saved_token_id_expired_at || null, existing[0].id]
      );
      console.log(`[vault] token kartu diperbarui (${parsed.brand} ****${parsed.last4})`);
      return rows[0];
    }

    const { rows: countRows } = await db.query(
      'SELECT COUNT(*) FROM payment_methods WHERE user_id = $1',
      [userId]
    );
    const isPrimary = Number(countRows[0].count) === 0;

    const { rows } = await db.query(
      `INSERT INTO payment_methods
         (user_id, brand, last4, exp_month, exp_year, saved_token_id, token_expires_at, is_primary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (user_id, saved_token_id) DO UPDATE SET token_expires_at = EXCLUDED.token_expires_at
       RETURNING id, brand, last4, exp_month, exp_year, is_primary, created_at`,
      [
        userId, parsed.brand, parsed.last4,
        exp?.month ?? null, exp?.year ?? null,
        body.saved_token_id, body.saved_token_id_expired_at || null,
        isPrimary,
      ]
    );
    console.log(`[vault] kartu tersimpan (${parsed.brand} ****${parsed.last4}, primary=${isPrimary})`);
    return rows[0];
  } catch (e) {
    // Jangan gagalkan konfirmasi pembayaran hanya karena capture bermasalah.
    console.error('[vault] capture gagal (diabaikan):', e.message);
    return null;
  }
}

/** Format baris DB ke kontrak Flutter — tanpa saved_token_id. */
function toMethodJson(row) {
  return {
    id: row.id,
    brand: row.brand,
    last4: row.last4,
    exp:
      row.exp_month && row.exp_year
        ? `${String(row.exp_month).padStart(2, '0')}/${String(row.exp_year).slice(-2)}`
        : null,
    is_primary: !!row.is_primary,
    // B4: julukan kartu ("Business") — null bila belum diberi nama.
    label: row.label || null,
  };
}

module.exports = { brandFromBin, parseMaskedCard, parseCardExpiry, captureSavedCard, toMethodJson };
