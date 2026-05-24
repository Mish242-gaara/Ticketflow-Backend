const express = require('express');
const router = express.Router();
const passport = require('passport');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// Imports groupés
const Auth = require('../controllers/authController');
const User = require('../controllers/userController');
const Announce = require('../controllers/announcementController');
const Event = require('../controllers/eventController');
const Ticket = require('../controllers/ticketController');

// Routes Admin
router.get('/admin/users', authMiddleware, adminMiddleware, User.getAllUsers);
router.delete('/admin/users/:userId', authMiddleware, adminMiddleware, User.deleteUser);
router.post('/admin/users/:userId/block', authMiddleware, adminMiddleware, User.blockUser);
router.post('/admin/users/:userId/unblock', authMiddleware, adminMiddleware, User.unblockUser);

router.post('/admin/announcements', authMiddleware, adminMiddleware, Announce.sendAnnouncement);
router.get('/admin/announcements', authMiddleware, adminMiddleware, Announce.getAnnouncements);
router.delete('/admin/announcements/:announcementId', authMiddleware, adminMiddleware, Announce.deleteAnnouncement);
router.delete('/admin/announcements', authMiddleware, adminMiddleware, Announce.deleteAllAnnouncements);

// Routes de base (Auth)
router.post('/auth/register', Auth.register);
router.post('/auth/login', Auth.login);
router.get('/auth/me', authMiddleware, Auth.me);

module.exports = router;