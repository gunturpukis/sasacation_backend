const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');

// GET /api/explore
// Query: category=Hotels|Destinations|Culinary|beaches|islands|adventure|culture
const getExplore = (req, res) => {
  const { category, search, page = 1, limit = 20 } = req.query;

  const categoryMap = {
    hotels: 'Hotels',
    beaches: 'Destinations',
    islands: 'Destinations',
    adventure: 'Destinations',
    culture: 'Destinations',
    destinations: 'Destinations',
    culinary: 'Culinary',
    restaurants: 'Culinary',
  };

  const subCategoryMap = {
    beaches: 'Beaches',
    islands: 'Islands',
    adventure: 'Adventure',
    culture: 'Culture',
  };

  const allItems = [
    ...db.hotels,
    ...db.destinations,
    ...db.restaurants,
  ];

  let filtered = allItems;

  if (category) {
    const normalizedCategory = category.toLowerCase();
    const mappedCategory = categoryMap[normalizedCategory];
    const mappedSubCategory = subCategoryMap[normalizedCategory];

    if (mappedCategory) {
      filtered = filtered.filter(item => {
        if (item.category !== mappedCategory) return false;
        if (mappedSubCategory && item.subCategory) {
          return item.subCategory === mappedSubCategory;
        }
        return true;
      });
    }
  }

  if (search) {
    filtered = filtered.filter(item =>
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.location.toLowerCase().includes(search.toLowerCase())
    );
  }

  const total = filtered.length;
  const startIdx = (Number(page) - 1) * Number(limit);
  const paginated = filtered.slice(startIdx, startIdx + Number(limit));

  res.json({
    success: true,
    data: paginated,
    meta: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) },
  });
};

// GET /api/explore/destinations
const getDestinations = (req, res) => {
  const { subCategory, search } = req.query;
  let data = [...db.destinations];
  if (subCategory) data = data.filter(d => d.subCategory?.toLowerCase() === subCategory.toLowerCase());
  if (search) data = data.filter(d => d.name.toLowerCase().includes(search.toLowerCase()));
  res.json({ success: true, data });
};

// GET /api/explore/destinations/:id
const getDestinationById = (req, res) => {
  const item = db.destinations.find(d => d.id === req.params.id);
  if (!item) return res.status(404).json({ success: false, message: 'Destinasi tidak ditemukan' });
  res.json({ success: true, data: item });
};

// GET /api/explore/restaurants
const getRestaurants = (req, res) => {
  const { search } = req.query;
  let data = [...db.restaurants];
  if (search) data = data.filter(r => r.name.toLowerCase().includes(search.toLowerCase()));
  res.json({ success: true, data });
};

// GET /api/explore/restaurants/:id
const getRestaurantById = (req, res) => {
  const item = db.restaurants.find(r => r.id === req.params.id);
  if (!item) return res.status(404).json({ success: false, message: 'Restoran tidak ditemukan' });
  res.json({ success: true, data: item });
};

// GET /api/explore/categories
const getCategories = (req, res) => {
  res.json({ success: true, data: db.categories });
};

module.exports = {
  getExplore,
  getDestinations,
  getDestinationById,
  getRestaurants,
  getRestaurantById,
  getCategories,
};
