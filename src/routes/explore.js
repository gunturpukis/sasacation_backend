const express = require('express');
const router = express.Router();
const {
  getExplore,
  getDestinations,
  getDestinationById,
  getRestaurants,
  getRestaurantById,
  getCategories,
} = require('../controllers/exploreController');

router.get('/', getExplore);
router.get('/categories', getCategories);
router.get('/destinations', getDestinations);
router.get('/destinations/:id', getDestinationById);
router.get('/restaurants', getRestaurants);
router.get('/restaurants/:id', getRestaurantById);

module.exports = router;
