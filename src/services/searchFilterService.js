// src/services/searchFilterService.js
// F.1: parser deterministik query natural language → filter terstruktur.
// DB-free & pure (tanpa Ollama) supaya bisa di-unit-test: node --test tests/ai-features.test.js
//
// Kontrak: parseSearchFilters(query) → {
//   city: string|null (lowercase, mis. "jakarta"),
//   amenities: string[] (key kanonis, mis. "bathtub"),
//   vibes: string[] (token normalisasi EN, mis. "quiet","romantic","luxury","couple"),
//   vibeLabels: string[] (label Indonesia untuk display, mis. "tenang"),
//   tripType: string|null ("couple"|"family"|"solo"|"group"|"business"),
//   maxPrice: number|null (USD, dibulatkan),
//   weekend: boolean,
//   confidence: number (0..1),
//   needsClarification: boolean,
// }
//
// IDR → USD: harga hotel di DB disimpan USD (ragIndexer "Harga: $..."),
// user menyebut Rupiah. Kurs kasar 16000 hanya untuk filter demo;
// presisi ikut pricing.fx (F14).

const IDR_TO_USD_RATE = 16000;

const AMENITY_KEYWORDS = {
  bathtub: ['bathtub', 'bath tub', 'bak mandi'],
  pool: ['pool', 'kolam', 'swimming'],
  wifi: ['wifi', 'wi-fi', 'internet'],
  gym: ['gym', 'fitness'],
  spa: ['spa'],
  breakfast: ['breakfast', 'sarapan'],
  beach: ['beach', 'pantai'],
  parking: ['parkir', 'parking'],
  restaurant: ['restoran', 'restaurant', 'resto'],
  bar: ['bar'],
  cafe: ['cafe', 'kafe', 'kopi', 'coffee'],
};

// vibe: [token normalisasi, ...keyword ID/EN]
const VIBE_RULES = [
  ['quiet', 'tenang', ['tenang', 'sunyi', 'sepi', 'quiet', 'calm']],
  ['romantic', 'romantis', ['romantis', 'romantic', 'honeymoon', 'couple', 'pasangan']],
  ['luxury', 'mewah', ['mewah', 'luxury', 'lux', 'premium']],
  ['budget', 'murah', ['murah', 'budget', 'hemat', 'affordable', 'cheap']],
  ['family', 'keluarga', ['keluarga', 'family', 'anak']],
  ['business', 'bisnis', ['bisnis', 'business', 'kerja', 'dinas']],
  ['nature', 'alam', ['alam', 'nature', 'pemandangan', 'view']],
  ['couple', 'couple', ['couple']], // eksplisit "couple" tanpa kata romantis
  ['beach', 'pantai', ['beach', 'pantai']],
  ['adventure', 'petualangan', ['petualangan', 'adventure', 'backpacker', 'mendaki', 'hiking']],
];

const TRIP_TYPE_RULES = [
  [/honeymoon|bulan madu|pasangan|couple|romantis|romantic/i, 'couple'],
  [/keluarga|family|anak/i, 'family'],
  [/solo|sendiri/i, 'solo'],
  [/grup|group|rombongan|teman|geng/i, 'group'],
  [/bisnis|business|dinas|kerja/i, 'business'],
];

// Kota populer untuk fallback tanpa preposisi ("staycation Jakarta").
// Multi-kata ditaruh dulu (scan berhenti di match pertama).
const KNOWN_CITIES = [
  'nusa dua', 'labuan bajo', 'bukittinggi', 'tanjung aan', 'selong belanak',
  'jakarta', 'bali', 'lombok', 'senggigi', 'mataram', 'kuta', 'ubud',
  'seminyak', 'canggu', 'gili', 'senaru', 'sembalun', 'tetebatu', 'sire',
  'bandung', 'surabaya', 'yogyakarta', 'jogja', 'semarang', 'solo', 'malang',
  'batu', 'banyuwangi', 'bromo', 'ijen', 'borobudur', 'prambanan', 'malioboro',
  'medan', 'padang', 'aceh', 'sabang', 'pekanbaru', 'palembang', 'lampung',
  'batam', 'bintan', 'belitung', 'bogor', 'depok', 'bekasi', 'tangerang',
  'cirebon', 'makassar', 'toraja', 'manado', 'bunaken', 'balikpapan',
  'pontianak', 'banjarmasin', 'derawan', 'komodo', 'rinca', 'padar',
  'sumba', 'flores', 'karimunjawa', 'wakatobi',
];

// Kata pertama hasil tangkapan preposisi yang BUKAN kota ("near beach" → beach).
const NON_CITY_WORDS = new Set([
  'beach', 'pantai', 'pool', 'kolam', 'hotel', 'resort', 'villa', 'resto',
  'restoran', 'restaurant', 'cafe', 'kafe', 'gunung', 'mountain', 'pusat',
  'kota', 'city', 'tengah', 'with', 'dengan',
]);

function parseBudgetToUSD(query) {
  const q = query.toLowerCase().replace(/\./g, '').replace(/,/g, '.');
  let m = q.match(/(\d+(?:\.\d+)?)\s*(jt|juta|miliar)/);
  if (m) {
    const mult = /miliar/.test(m[2]) ? 1e9 : 1e6;
    return Math.round((parseFloat(m[1]) * mult) / IDR_TO_USD_RATE);
  }
  // "\b m" saja (mis. "1.5M") — hati-hati jangan makan kata lain
  m = q.match(/(\d+(?:\.\d+)?)\s*m\b/);
  if (m && /budget|harga|bawah|rp|idr/i.test(q)) {
    return Math.round((parseFloat(m[1]) * 1e6) / IDR_TO_USD_RATE);
  }
  m = q.match(/(\d+(?:\.\d+)?)\s*(k|rb|ribu)/);
  if (m) return Math.round((parseFloat(m[1]) * 1000) / IDR_TO_USD_RATE);
  m = q.match(/rp\s*([\d\s]+)/);
  if (m) {
    const v = parseInt(m[1].replace(/\s/g, ''), 10);
    if (!Number.isNaN(v) && v > 0) return Math.round(v / IDR_TO_USD_RATE);
  }
  m = q.match(/\$\s*(\d+(?:\.\d+)?)/) || q.match(/(\d+(?:\.\d+)?)\s*(usd|dollar|dolar)/);
  if (m) return Math.round(parseFloat(m[1]));
  m = q.match(/budget\s*(\d{5,})/);
  if (m) return Math.round(parseInt(m[1], 10) / IDR_TO_USD_RATE);
  return null;
}

function parseSearchFilters(query) {
  const raw = typeof query === 'string' ? query : '';
  const q = raw.toLowerCase();

  const maxPrice = parseBudgetToUSD(raw);
  const amenities = Object.keys(AMENITY_KEYWORDS).filter(k =>
    AMENITY_KEYWORDS[k].some(kw => q.includes(kw)));

  const vibes = [];
  const vibeLabels = [];
  for (const [token, label, kws] of VIBE_RULES) {
    if (kws.some(kw => q.includes(kw)) && !vibes.includes(token)) {
      vibes.push(token);
      if (!vibeLabels.includes(label)) vibeLabels.push(label);
    }
  }

  let tripType = null;
  for (const [re, t] of TRIP_TYPE_RULES) {
    if (re.test(raw)) { tripType = t; break; }
  }
  // "couple" mentah tanpa kata romantis → tetap tripType couple
  if (!tripType && /\bcouple\b/i.test(raw)) tripType = 'couple';

  let city = null;
  // Tangkap 1 kata setelah preposisi; perluas ke 2 kata HANYA bila gabungannya
  // kota multi-kata yang dikenal ("nusa dua") — kalau tidak, "di senggigi
  // honeymoon" akan terseret jadi "senggigi honeymoon".
  const cityMatch = raw.match(/(?:\bdi\b|\bke\b|\bnear\b|\bdekat\b)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’\-]*)(?:\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’\-]*))?/);
  if (cityMatch && !NON_CITY_WORDS.has(cityMatch[1].toLowerCase())) {
    const two = cityMatch[2] ? `${cityMatch[1]} ${cityMatch[2]}`.toLowerCase() : null;
    city = (two && KNOWN_CITIES.includes(two) ? two : cityMatch[1]).toLowerCase();
  }
  // Fallback: kota populer disebut tanpa preposisi ("staycation Jakarta")
  if (!city) {
    for (const c of KNOWN_CITIES) {
      if (new RegExp(`\\b${c.replace(/ /g, '\\s+')}\\b`, 'i').test(raw)) { city = c; break; }
    }
  }

  const weekend = /weekend|akhir pekan|sabtu|minggu/i.test(raw);

  // Confidence: 0.15 dasar bila ada kata travel; +0.2 per sinyal kuat.
  let confidence = 0;
  if (/hotel|resort|villa|penginapan|staycation|wisata|makan|resto|restoran|destinasi|tempat/i.test(raw)) confidence += 0.15;
  if (city) confidence += 0.2;
  if (maxPrice != null) confidence += 0.2;
  if (amenities.length) confidence += 0.15;
  if (vibes.length) confidence += 0.15;
  if (tripType) confidence += 0.1;
  confidence = Math.min(0.95, Math.round(confidence * 100) / 100);

  return {
    city, amenities, vibes, vibeLabels, tripType, maxPrice, weekend,
    confidence,
    needsClarification: confidence < 0.4,
  };
}

module.exports = { parseSearchFilters, parseBudgetToUSD, IDR_TO_USD_RATE };
