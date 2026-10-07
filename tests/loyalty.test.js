// tests/loyalty.test.js
// Unit test murni (DB-free) untuk Loyalty Ledger (LOYALTY_DEFINITION.md).
// Aturan yang dikunci: 100 poin = Rp10.000, minimal 100, kelipatan 100,
// maksimal 50% subtotal, tier Bronze/Silver/Gold/Platinum.
// Jalankan: node --test tests/loyalty.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  tierFor, discountUsdFor, conversion,
  validateRedeemQty, quoteRedeem, MIN_REDEEM,
} = require('../src/services/loyaltyService');

const RATE = 16000;

describe('tierFor', () => {
  it('batas tier sesuai definisi', () => {
    assert.equal(tierFor(0), 'Bronze');
    assert.equal(tierFor(99), 'Bronze');
    assert.equal(tierFor(100), 'Silver');
    assert.equal(tierFor(499), 'Silver');
    assert.equal(tierFor(500), 'Gold');
    assert.equal(tierFor(1999), 'Gold');
    assert.equal(tierFor(2000), 'Platinum');
  });
});

describe('discountUsdFor (100 poin = Rp10.000)', () => {
  it('160 poin = $1 pada kurs 16000', () => {
    assert.equal(discountUsdFor(160, RATE), 1);
  });
  it('tidak pernah membulatkan ke atas', () => {
    assert.equal(discountUsdFor(100, RATE), 0.62); // 0.625 → floor sen
  });
});

describe('conversion', () => {
  it('membawa konstanta kontrak agar Flutter tidak hardcode', () => {
    const c = conversion(RATE);
    assert.equal(c.points_per_10000_idr, 100);
    assert.equal(c.min_redeem, MIN_REDEEM);
    assert.equal(c.max_pct, 50);
    assert.equal(c.usd_to_idr_rate, RATE);
  });
});

describe('validateRedeemQty', () => {
  it('menolak di bawah minimal', () => {
    assert.throws(() => validateRedeemQty(50), /minimal/);
  });
  it('menolak bukan kelipatan 100', () => {
    assert.throws(() => validateRedeemQty(150), /kelipatan 100/);
  });
  it('menerima kelipatan 100 >= 100', () => {
    validateRedeemQty(100);
    validateRedeemQty(2000);
  });
});

describe('quoteRedeem', () => {
  it('redeem normal: 200 poin untuk subtotal $100', () => {
    const q = quoteRedeem({ balance: 500, redeemPoints: 200, subtotalUsd: 100, rate: RATE });
    assert.equal(q.redeemPoints, 200);
    assert.equal(q.discountUsd, 1.25);
  });
  it('saldo kurang → 400', () => {
    assert.throws(
      () => quoteRedeem({ balance: 50, redeemPoints: 100, subtotalUsd: 100, rate: RATE }),
      /tidak cukup/
    );
  });
  it('dibatasi 50% subtotal (subtotal $2, minta 500 poin → turun ke 100)', () => {
    const q = quoteRedeem({ balance: 1000, redeemPoints: 500, subtotalUsd: 2, rate: RATE });
    assert.equal(q.redeemPoints, 100);
    assert.equal(q.discountUsd, 0.62);
  });
  it('subtotal terlalu kecil untuk redeem minimal → 400', () => {
    assert.throws(
      () => quoteRedeem({ balance: 1000, redeemPoints: 100, subtotalUsd: 0.5, rate: RATE }),
      /terlalu kecil/
    );
  });
});
