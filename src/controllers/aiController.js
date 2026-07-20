const { chatWithAssistant, smartSearch, generateDescription, generateTripPlan } = require('../services/aiService');
const chatSessionService = require('../services/chatSessionService');
const { extractAndMergePreferences } = require('../services/preferenceExtractorService');

// Tiap berapa pesan user, jalankan ekstraksi preferensi. 3 dipilih sebagai
// keseimbangan: cukup sering supaya memory terasa "hidup", tapi tidak
// memanggil LLM ekstra di SETIAP single turn (boros GPU/CPU lokal).
const EXTRACTION_INTERVAL = 3;

const chat = async (req, res) => {
  try {
    const { messages, sessionId } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0)
      return res.status(400).json({ success: false, message: 'messages wajib diisi' });

    const userName = req.user?.name || 'Wisatawan';
    const reply = await chatWithAssistant({ messages, userName, userId: req.user?.id });

    // Persistensi & auto-extract preferensi HANYA untuk user yang login.
    // Guest tetap bisa chat seperti biasa (backward compatible), tapi
    // percakapannya tidak disimpan — sama seperti perilaku sebelumnya.
    let resolvedSessionId = null;
    if (req.user?.id) {
      resolvedSessionId = await chatSessionService.getOrCreateSession(req.user.id, sessionId);

      const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content;
      if (lastUserMessage) {
        await chatSessionService.appendMessage(resolvedSessionId, 'user', lastUserMessage);
      }
      await chatSessionService.appendMessage(resolvedSessionId, 'assistant', reply);

      // Fire-and-forget: TIDAK di-await supaya tidak menambah latency
      // response chat utama. Kegagalannya sudah di-handle (log-only) di
      // dalam extractAndMergePreferences sendiri.
      chatSessionService.countUserMessages(resolvedSessionId).then((count) => {
        if (count % EXTRACTION_INTERVAL !== 0) return;
        chatSessionService.getRecentMessages(resolvedSessionId, EXTRACTION_INTERVAL * 2)
          .then((recent) => extractAndMergePreferences(req.user.id, recent));
      }).catch((e) => console.error('[chat] Gagal cek counter ekstraksi (diabaikan):', e.message));
    }

    res.json({ success: true, data: { reply, role: 'assistant', sessionId: resolvedSessionId } });
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

    const plan = await generateTripPlan({ duration, budget, interests, startDate, groupType, userId: req.user.id });
    res.json({ success: true, data: plan });
  } catch (e) {
    console.error('Trip plan error:', e);
    res.status(500).json({ success: false, message: 'AI trip plan error', error: e.message });
  }
};

module.exports = { chat, search, generateDesc, tripPlan };
