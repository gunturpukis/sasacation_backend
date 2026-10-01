// src/routes/itineraries.js
const express = require('express');
const router = express.Router();
const {
  createItinerary, getMyItineraries, getItineraryById, updateItinerary,
  deleteItinerary, addItem, updateItem, deleteItem,
} = require('../controllers/itinerariesController');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware); // semua itinerary wajib login

// HARUS sebelum /:id agar tidak tertangkap sebagai id
router.get('/my', getMyItineraries);
router.patch('/items/:itemId', updateItem);
router.delete('/items/:itemId', deleteItem);

router.post('/', createItinerary);
router.get('/:id', getItineraryById);
router.put('/:id', updateItinerary);
router.delete('/:id', deleteItinerary);
router.post('/:id/items', addItem);

module.exports = router;
