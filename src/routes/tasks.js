// src/routes/tasks.js
const express = require('express');
const router = express.Router();
const { createTask, getMyTasks, updateTask, setDone, deleteTask } = require('../controllers/tasksController');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware); // semua task wajib login

router.get('/my', getMyTasks); // HARUS sebelum /:id
router.post('/', createTask);
router.put('/:id', updateTask);
router.patch('/:id/done', setDone);
router.delete('/:id', deleteTask);

module.exports = router;
