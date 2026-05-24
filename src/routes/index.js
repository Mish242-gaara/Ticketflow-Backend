const express = require('express');
const router = express.Router();
const passport = require('passport');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { handlePawaPayWebhook } = require('../services/paymentService');
const { handleMtnWebhook } = require('../services/mtnMomoService');

// Imports des contrôleurs
const { register, login, me, updateProfile } = require('../controllers/authController');
const { getAllUsers, deleteUser, blockUser, unblockUser } = require('../controllers/userController');
const { sendAnnouncement, getAnnouncements, deleteAnnouncement, deleteAllAnnouncements } = require('../controllers/announcementController');
const { getAllEvents, getEvent, getEventById, createEvent, updateEvent, deleteEvent, getAttendees, getAdminEvents, deleteAttendee, hardDeleteAttendee } = require('../controllers/eventController');
const { reserveTicket, checkPayment, myTickets, getTicket, downloadTicket, verifyTicket, getAdminStats, validatePaymentManually, getPendingTickets } = require('../controllers/ticketController');

// Routes
router.post('/auth/register', register);
router.post('/auth/login', login);
router.get('/auth/me', authMiddleware, me);
router.put('/auth/profile', authMiddleware, updateProfile);

router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: `${process.env.FRONTEND_URL}/login?error=google` }), (req, res) => {
    const { token, user } = req.user;
    res.redirect(`${process.env.FRONTEND_URL}/auth/callback?token=${token}&user=${encodeURIComponent(JSON.stringify(user))}`);
});

router.get('/events', getAllEvents);
router.get('/admin/users', authMiddleware, adminMiddleware, getAllUsers);
router.delete('/admin/users/:userId', authMiddleware, adminMiddleware, deleteUser);
router.post('/admin/users/:userId/block', authMiddleware, adminMiddleware, blockUser);
router.post('/admin/users/:userId/unblock', authMiddleware, adminMiddleware, unblockUser);
router.post('/admin/announcements', authMiddleware, adminMiddleware, sendAnnouncement);
router.get('/admin/announcements', authMiddleware, adminMiddleware, getAnnouncements);
router.delete('/admin/announcements/:announcementId', authMiddleware, adminMiddleware, deleteAnnouncement);
router.delete('/admin/announcements', authMiddleware, adminMiddleware, deleteAllAnnouncements);

module.exports = router;