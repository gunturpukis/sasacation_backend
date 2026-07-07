// src/routes/rag.js
// Endpoint tambahan untuk debug/testing RAG secara langsung
// (tanpa lewat LLM, murni similarity search dari pgvector)

const express = require('express');
const router = express.Router();
const { ragRetrieve } = require('../services/ragService');

// GET /api/rag/search?q=hotel+pantai&topK=5&type=hotel
router.get('/search', async (req, res) => {
  try {
    const { q, topK, type } = req.query;
    if (!q) return res.status(400).json({ success: false, message: 'query parameter q wajib diisi' });

    const { docs } = await ragRetrieve(q, {
      topK: topK ? Number(topK) : 5,
      docType: type || null,
    });

    res.json({
      success: true,
      query: q,
      totalFound: docs.length,
      data: docs.map(d => ({
        docId: d.doc_id,
        docType: d.doc_type,
        similarity: (d.similarity * 100).toFixed(1) + '%',
        metadata: d.metadata,
        contentPreview: d.content.substring(0, 150) + '...',
      })),
    });
  } catch (e) {
    res.status(500).json({ success: false, message: 'RAG search error', error: e.message });
  }
});

module.exports = router;
