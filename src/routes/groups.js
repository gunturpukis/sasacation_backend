// src/routes/groups.js
const express = require('express');
const router = express.Router();
const {
  createGroup, getMyGroups, getGroupById, addMember, removeMember,
  addExpense, deleteExpense, deleteGroup,
} = require('../controllers/groupsController');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware); // semua grup wajib login

router.get('/my', getMyGroups); // HARUS sebelum /:id
router.post('/', createGroup);
router.get('/:id', getGroupById);
router.delete('/:id', deleteGroup);
router.post('/:id/members', addMember);
router.delete('/:id/members/:userId', removeMember);
router.post('/:id/expenses', addExpense);
router.delete('/:id/expenses/:expenseId', deleteExpense);

module.exports = router;
