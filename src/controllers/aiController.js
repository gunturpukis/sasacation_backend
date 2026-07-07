const { chatWithAssistant, smartSearch, generateDescription, generateTripPlan } = require('../services/aiService');

const chat = async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0)
      return res.status(400).json({ success: false, message: 'messages wajib diisi' });

    const userName = req.user?.name || 'Wisatawan';
    const reply = await chatWithAssistant({ messages, userName });
    res.json({ success: true, data: { reply, role: 'assistant' } });
  } catch (e) {
    console.error('AI Chat error:', e);
    res.status(500).json({ success: false, message: 'AI service error', error: e.message });
  }
};

const search = async (req, res) => {
  try {
    const { query } = req.body;
    if (!query?.trim())
      return res.status(400).json({ success: false, message: 'query wajib diisi' });

    const result = await smartSearch({ query });
    res.json({ success: true, data: result });
  } catch (e) {
    console.error('AI Search error:', e);
    res.status(500).json({ success: false, message: 'AI search error', error: e.message });
  }
};

const generateDesc = async (req, res) => {
  try {
    const { type, name, location, amenities, price, rating } = req.body;
    if (!type || !name || !location)
      return res.status(400).json({ success: false, message: 'type, name, location wajib diisi' });

    const description = await generateDescription({ type, name, location, amenities, price, rating });
    res.json({ success: true, data: { description } });
  } catch (e) {
    console.error('Generate description error:', e);
    res.status(500).json({ success: false, message: 'AI description error', error: e.message });
  }
};

const tripPlan = async (req, res) => {
  try {
    const { duration, budget, interests, startDate, groupType } = req.body;
    if (!duration || !budget || !interests?.length)
      return res.status(400).json({ success: false, message: 'duration, budget, dan interests wajib diisi' });

    const plan = await generateTripPlan({ duration, budget, interests, startDate, groupType });
    res.json({ success: true, data: plan });
  } catch (e) {
    console.error('Trip plan error:', e);
    res.status(500).json({ success: false, message: 'AI trip plan error', error: e.message });
  }
};

module.exports = { chat, search, generateDesc, tripPlan };
