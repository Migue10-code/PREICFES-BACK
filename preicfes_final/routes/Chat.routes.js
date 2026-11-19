const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/Chat.controller');

router.post('/', ctrl.responder);

module.exports = router;