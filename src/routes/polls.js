// src/routes/polls.js
const express = require('express');
const router = express.Router();
const {
  createPoll, getOpenPolls, getMyPolls, getPollById, vote, closePoll, deletePoll,
} = require('../controllers/pollsController');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware); // semua vote wajib login

// HARUS sebelum /:id
router.get('/open', getOpenPolls);
router.get('/my', getMyPolls);

router.post('/', createPoll);
router.get('/:id', getPollById);
router.post('/:id/vote', vote);
router.patch('/:id/close', closePoll);
router.delete('/:id', deletePoll);

module.exports = router;
