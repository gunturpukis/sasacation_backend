const { chatWithAssistant, smartSearch, generateDescription, generateTripPlan } = require('../services/aiService');
const db = require('../config/database');

// ─── POST /api/ai/chat ────────────────────────────────────────────────────────
// Body: { messages: [{role, content}], userId? }
// Auth: optional (untuk personalisasi)
const chat = async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ success: false, message: 'messages wajib diisi' });
    }

    const userName = req.user?.name || 'Wisatawan';
    const reply = await chatWithAssistant({ messages, userName });

    res.json({ success: true, data: { reply, role: 'assistant' } });
  } catch (error) {
    console.error('AI Chat error:', error);
    res.status(500).json({ success: false, message: 'AI service error', error: error.message });
  }
};

// ─── POST /api/ai/search ──────────────────────────────────────────────────────
// Body: { query: string }
const search = async (req, res) => {
  try {
    const { query } = req.body;
    if (!query?.trim()) {
      return res.status(400).json({ success: false, message: 'query wajib diisi' });
    }

    // Parse intent dengan AI
    const parsed = await smartSearch({ query });

    // Eksekusi search ke database berdasarkan hasil parsing
    const allItems = [...db.hotels, ...db.destinations, ...db.restaurants];
    let results = allItems;

    // Filter by category
    if (parsed.category && parsed.category !== 'All') {
      const catMap = {
        'Hotels': 'Hotels', 'Destinations': 'Destinations', 'Culinary': 'Culinary',
        'Beaches': 'Destinations', 'Islands': 'Destinations',
        'Adventure': 'Destinations', 'Culture': 'Destinations',
      };
      const mappedCat = catMap[parsed.category];
      if (mappedCat) results = results.filter(i => i.category === mappedCat);
    }

    // Filter by searchQuery
    if (parsed.searchQuery) {
      const q = parsed.searchQuery.toLowerCase();
      results = results.filter(i =>
        i.name.toLowerCase().includes(q) ||
        i.location.toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q)
      );
    }

    // Filter by price
    if (parsed.filters?.maxPrice) {
      results = results.filter(i => i.price === 0 || i.price <= parsed.filters.maxPrice);
    }
    if (parsed.filters?.minRating) {
      results = results.filter(i => i.rating >= parsed.filters.minRating);
    }

    res.json({
      success: true,
      data: {
        interpretation: parsed.interpretation,
        category: parsed.category,
        suggestions: parsed.suggestions,
        results,
        totalResults: results.length,
      },
    });
  } catch (error) {
    console.error('AI Search error:', error);
    res.status(500).json({ success: false, message: 'AI search error', error: error.message });
  }
};

// ─── POST /api/ai/generate-description ───────────────────────────────────────
// Body: { type, name, location, amenities?, price?, rating? }
// Auth: admin only
const generateDesc = async (req, res) => {
  try {
    const { type, name, location, amenities, price, rating } = req.body;
    if (!type || !name || !location) {
      return res.status(400).json({ success: false, message: 'type, name, location wajib diisi' });
    }

    const description = await generateDescription({ type, name, location, amenities, price, rating });
    res.json({ success: true, data: { description } });
  } catch (error) {
    console.error('Generate description error:', error);
    res.status(500).json({ success: false, message: 'AI description error', error: error.message });
  }
};

// ─── POST /api/ai/trip-plan ───────────────────────────────────────────────────
// Body: { duration, budget, interests, startDate?, groupType? }
// Auth: required
const tripPlan = async (req, res) => {
  try {
    const { duration, budget, interests, startDate, groupType } = req.body;
    if (!duration || !budget || !interests?.length) {
      return res.status(400).json({
        success: false,
        message: 'duration, budget, dan interests wajib diisi',
      });
    }

    const plan = await generateTripPlan({ duration, budget, interests, startDate, groupType });
    res.json({ success: true, data: plan });
  } catch (error) {
    console.error('Trip plan error:', error);
    res.status(500).json({ success: false, message: 'AI trip plan error', error: error.message });
  }
};

module.exports = { chat, search, generateDesc, tripPlan };
