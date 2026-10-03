// src/services/weatherService.js
// Integrasi OpenWeather untuk kartu "Destination Alert" Figma
// (mis. "Thunderstorms expected in Ubud... Reschedule Itinerary").
//
// API key dari env WEATHER_API_KEY (paket gratis: 60 call/menit).
// Cache in-memory 10 menit per koordinat (hemat kuota + respons cepat).
// Tanpa key → throw WEATHER_NOT_READY (controller balas 503).
// Key invalid/upstream error → throw dengan pesan jelas (controller balas 502).

const API_URL = 'https://api.openweathermap.org/data/2.5';
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // key: `${lat},${lng}` → { at, data }

function requireKey() {
  const key = process.env.WEATHER_API_KEY;
  if (!key) {
    const err = new Error('WEATHER_API_KEY belum diisi di .env — alert cuaca nonaktif');
    err.code = 'WEATHER_NOT_READY';
    throw err;
  }
  return key;
}

async function fetchJson(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`OpenWeather ${res.status}: ${data.message || 'upstream error'}`);
    err.code = 'WEATHER_UPSTREAM';
    err.status = res.status;
    throw err;
  }
  return data;
}

function pickCurrent(w) {
  const cond = w.weather?.[0] || {};
  return {
    temp_c: w.main?.temp ?? null,
    feels_like_c: w.main?.feels_like ?? null,
    humidity: w.main?.humidity ?? null,
    condition_id: cond.id ?? null,
    condition: cond.main || null,
    description: cond.description || null,
    icon: cond.icon || null,
    wind_ms: w.wind?.speed ?? null,
    location: w.name || null,
    observed_at: w.dt ? new Date(w.dt * 1000).toISOString() : null,
  };
}

// Pindai forecast 3-jam-an 24 jam ke depan; kembalikan alert pertama yang
// parah (badai/kilat/hujan ekstrem/angin ribut), atau null bila aman.
function detectAlert(list) {
  const horizon = Date.now() + 24 * 3600 * 1000;
  const hits = (list || [])
    .filter((f) => f.dt * 1000 <= horizon)
    .map((f) => ({ at: f.dt * 1000, id: f.weather?.[0]?.id, main: f.weather?.[0]?.main }))
    .filter((f) => typeof f.id === 'number' && (f.id < 300 || f.id >= 502));

  if (hits.length === 0) return null;

  const severe = hits.some((h) => h.id < 300 || h.id === 781);
  const from = new Date(hits[0].at);
  const to = new Date(hits[hits.length - 1].at + 3 * 3600 * 1000);
  const fmt = (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const stormy = hits[0].id < 300;
  return {
    severity: severe ? 'high' : 'medium',
    kind: stormy ? 'thunderstorm' : 'heavy_rain',
    title: stormy ? 'Thunderstorm expected' : 'Heavy rain expected',
    window: `${fmt(from)}–${fmt(to)}`,
  };
}

async function getWeatherWithAlert(lat, lng) {
  const key = requireKey();
  const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit.data, cached: true };

  const [current, forecast] = await Promise.all([
    fetchJson(`${API_URL}/weather?lat=${lat}&lon=${lng}&appid=${key}&units=metric`),
    fetchJson(`${API_URL}/forecast?lat=${lat}&lon=${lng}&appid=${key}&units=metric&cnt=8`),
  ]);

  const data = { current: pickCurrent(current), alert: detectAlert(forecast.list), cached: false };
  cache.set(cacheKey, { at: Date.now(), data });
  return data;
}

module.exports = { getWeatherWithAlert };
