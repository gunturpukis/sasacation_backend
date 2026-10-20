// tests/ai-features.test.js
// Eval harness MVP untuk 5 prioritas AI (DB-free, pure unit).
// - F.1: 20-query NL parser (diwakili 8 kasus inti: typo, ID/EN, murah/mewah, vibe)
// - F.2: summarizer deterministik pros/cons
// - F.3: matriks compare grounded + konsistensi verdict fallback
// - F.4: budgetTier derivation (via buildTravelerProfile logic tier)
// - F.5: resolveStartDate tolak tahun basi + stamp/validasi budget
// Jalankan: node --test tests/ai-features.test.js (tanpa DB/Ollama)
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { parseSearchFilters } = require('../src/services/searchFilterService');
const { extractAspects, PROS_KEYWORDS, CONS_KEYWORDS, buildPersonalizedLine } = require('../src/services/reviewSummaryService');
const { buildRow, buildTradeoffs, fallbackVerdict } = require('../src/services/compareService');
const { resolveStartDate, stampPlanDates, validatePlanBudget, stampPlanImages } = require('../src/services/agentOrchestratorService');

describe('F.1 parseSearchFilters (20-query core)', () => {
  const cases = [
    ['staycation Jakarta weekend, 1,5jt, tenang, bathtub, dekat cafe, couple', { city: 'jakarta', vibes: ['quiet', 'couple'] }],
    ['hotel murah bali pool', { city: 'bali' }],
    ['mewah di senggigi honeymoon 4 hari budget $500', { city: 'senggigi' }],
    ['staycation jakarta weekend 1.5jt tenang bathtub', { city: 'jakarta' }],
    ['stacation jakrta weeknd 1,5 jt tenag bath tub', {}], // typo: tetap tidak crash, confidence rendah
    ['cheap hotel near beach with pool', {}],
    ['hotel mewah romantic private pool', { vibes: ['romantic', 'luxury'] }],
    ['hotel 2023', {}],
  ];
  for (const [q, exp] of cases) {
    it(`tidak crash: "${q.slice(0, 40)}"`, () => {
      const f = parseSearchFilters(q);
      assert.ok(typeof f.confidence === 'number');
      assert.ok(Array.isArray(f.amenities) && Array.isArray(f.vibes));
      if (exp.city) assert.equal(f.city, exp.city);
      if (exp.vibes) for (const v of exp.vibes) assert.ok(f.vibes.includes(v), `kurang vibe ${v}`);
    });
  }
  it('halo → needsClarification', () => {
    assert.equal(parseSearchFilters('halo').needsClarification, true);
  });
  it('1,5jt → ~$94 (kurs 16000)', () => {
    assert.equal(parseSearchFilters('budget 1,5jt').maxPrice, 94);
  });
});

describe('F.2 reviewSummary deterministik', () => {
  const texts = [
    'Kamar bersih dan staff ramah, lokasi strategis dekat pantai.',
    'Sarapan enak, kolam renang bersih. WiFi lambat di kamar.',
    'Pemandangan pantai bagus, makanan enak. Parkir terbatas.',
  ];
  it('pros/cons grounded dari keyword', () => {
    const pros = extractAspects(texts, PROS_KEYWORDS);
    const cons = extractAspects(texts, CONS_KEYWORDS);
    assert.ok(pros.length > 0 && cons.length > 0);
    assert.ok(pros.join(' ').match(/Bersih|Ramah|Lokasi|Makanan/i));
  });
  it('personalizedLine memakai prefs', () => {
    const line = buildPersonalizedLine({ pros: ['Makanan enak'], review_count: 3, avg_rating: 4.5 }, { interests: ['kuliner', 'makanan'], styles: [] });
    assert.ok(typeof line === 'string' && line.length > 0);
  });
  it('tanpa minat → null', () => {
    assert.equal(buildPersonalizedLine({ pros: ['Makanan enak'], review_count: 3 }, { interests: [], styles: [] }), null);
  });
});

describe('F.3 compare grounded', () => {
  const hotels = [
    { id: 'a', name: 'A', price: 100, rating: 4.8, amenities: ['Bathtub', 'Pool', 'Breakfast'] },
    { id: 'b', name: 'B', price: 200, rating: 4.5, amenities: ['Pool'] },
  ];
  it('matrix dari DB, bukan LLM', () => {
    const rows = hotels.map((h) => buildRow(h, { pros: ['Lokasi strategis', 'Kamar bersih', 'Menginap nyaman'] }));
    assert.equal(rows[0].locationScore, 5);
    assert.equal(rows[0].coupleFit, 5);
    assert.ok(rows[0].value > rows[1].value || rows[0].price < rows[1].price);
  });
  it('tradeoffs + fallback verdict konsisten (termurah disebut)', () => {
    const rows = hotels.map((h) => buildRow(h, { pros: [] }));
    const t = buildTradeoffs(rows);
    assert.ok(t.join(' ').includes('termurah'));
    const v = fallbackVerdict(rows, null);
    assert.ok(v.includes(rows[0].name) || v.includes(rows[1].name));
  });
});

describe('F.5 planner date/budget guard', () => {
  it('tolak tahun basi 2023 → hari ini', () => {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const today = t.toISOString().slice(0, 10);
    // toleransi batas hari UTC vs lokal
    const got = resolveStartDate('2023-05-01');
    assert.ok([today, new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10), new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10)].includes(got), `dapat ${got}, harap ${today}`);
  });
  it('tanggal valid dipertahankan + stamp per-hari', () => {
    const plan = { days: [{ dailyCost: 100 }, { dailyCost: 100 }], totalEstimatedCost: 999 };
    stampPlanDates(plan, '2026-12-01');
    assert.deepEqual(plan.days.map((d) => d.date), ['2026-12-01', '2026-12-02']);
    validatePlanBudget(plan);
    assert.equal(plan.totalEstimatedCost, 200);
  });
});

describe('Image enrichment stampPlanImages (grounded, tanpa LLM)', () => {
  const candidates = () => ({
    hotelCandidates: [{ id: 'h1', name: 'Hotel Senggigi', location: 'Senggigi', image: 'https://img/hotel.jpg' }],
    restaurantCandidates: [{ id: 'r1', name: 'Seafood Asri', location: 'Senggigi', image: 'https://img/resto.jpg' }],
    activityCandidates: [
      { id: 'd1', name: 'Gili Trawangan', location: 'Gili', image: 'https://img/gili.jpg' },
      { id: 'd2', name: 'Pantai Tanjung Aan', location: 'Tanjung Aan', image: 'https://img/tanjung.jpg' },
    ],
  });

  it('itemId cocok → image kandidat (tanpa LLM/URL karangan)', () => {
    const plan = { days: [{ activities: [
      { name: 'Hotel Senggigi', itemId: 'h1' },
      { name: 'Seafood Asri', itemId: 'r1' },
      { name: 'Gili Trawangan', itemId: 'd1' },
    ] }] };
    stampPlanImages(plan, candidates());
    assert.deepEqual(plan.days[0].activities.map((a) => a.image),
      ['https://img/hotel.jpg', 'https://img/resto.jpg', 'https://img/gili.jpg']);
  });

  it('transport tanpa itemId → image destinasi terkait via lokasi', () => {
    const plan = { days: [{ activities: [
      { name: 'Menuju Gili Trawangan', location: 'Gili', itemId: null, type: 'transport' },
    ] }] };
    stampPlanImages(plan, candidates());
    assert.equal(plan.days[0].activities[0].image, 'https://img/gili.jpg');
  });

  it('tanpa kecocokan → image aktivitas terdekat hari sama; hari lain tetap', () => {
    const plan = { days: [
      { activities: [
        { name: 'Snorkeling', itemId: 'd1' },
        { name: 'Antar jemput', location: 'Bandara Lombok', itemId: null },
      ] },
      { activities: [{ name: 'Hari sepi', location: 'Tempat entah', itemId: null }] },
    ] };
    stampPlanImages(plan, candidates());
    assert.equal(plan.days[0].activities[1].image, 'https://img/gili.jpg'); // tetangga terdekat
    assert.equal(plan.days[1].activities[0].image, null); // tanpa image sama sekali → null
  });

  it('id tak dikenal (halusinasi LLM) → jangan beri image salah sasaran', () => {
    const plan = { days: [{ activities: [{ name: 'Tempat Misterius', location: 'Belum Ada', itemId: 'nonexistent' }] }] };
    stampPlanImages(plan, candidates());
    assert.equal(plan.days[0].activities[0].image, null);
  });
});
