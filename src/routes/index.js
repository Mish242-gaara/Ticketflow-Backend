const express = require('express');
const router = express.Router();
const passport = require('passport');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { handlePawaPayWebhook } = require('../services/paymentService');
const { handleMtnWebhook } = require('../services/mtnMomoService');

// =============================================
// IMPORTS DES CONTRÔLEURS
// =============================================
// ✅ Contrôleurs Auth
const {
  register,
  login,
  me,
  updateProfile
} = require('../controllers/authController');

// ✅ Contrôleurs Utilisateurs
const {
  getAllUsers,
  deleteUser,
  blockUser,
  unblockUser
} = require('../controllers/userController');

// ✅ Contrôleurs Annonces
const {
  sendAnnouncement,
  getAnnouncements,
  deleteAnnouncement,
  deleteAllAnnouncements
} = require('../controllers/announcementController');

// ✅ Contrôleurs Événements
const {
  getAllEvents,
  getEvent,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
  getAttendees,
  getAdminEvents,
  deleteAttendee,
  hardDeleteAttendee
} = require('../controllers/eventController');

// ✅ Contrôleurs Tickets
const {
  reserveTicket,
  checkPayment,
  myTickets,
  getTicket,
  downloadTicket,
  verifyTicket,
  getAdminStats,
  validatePaymentManually,
  getPendingTickets
} = require('../controllers/ticketController');

// =============================================
// ROUTES AUTH
// =============================================
router.post('/auth/register', register);
router.post('/auth/login', login);
router.get('/auth/me', authMiddleware, me);
router.put('/auth/profile', authMiddleware, updateProfile);

// ✅ Google OAuth
router.get('/auth/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    redirect_uri: process.env.GOOGLE_CALLBACK_URI || 'https://ticketflow-backend-h7m6.onrender.com/api/auth/google/callback'
  })
);

router.get('/auth/google/callback',
  passport.authenticate('google', {
    failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?error=google`
  }),
  (req, res) => {
    if (!req.user || !req.user.token || !req.user.user) {
      console.error('❌ [Google OAuth Callback] req.user est vide ou incomplet');
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?error=google_incomplete`);
    }
    const { token, user } = req.user;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    console.log(`✅ [Google OAuth Callback] Redirection vers ${frontendUrl}/auth/callback`);
    res.redirect(`${frontendUrl}/auth/callback?token=${token}&user=${encodeURIComponent(JSON.stringify(user))}`);
  }
);

// =============================================
// ROUTES ÉVÉNEMENTS
// =============================================
router.get('/events', getAllEvents);
router.get('/events/:slug', getEvent);
router.get('/admin/events', authMiddleware, adminMiddleware, getAdminEvents);
router.get('/admin/events/:id', authMiddleware, adminMiddleware, getEventById);
router.post('/events', authMiddleware, adminMiddleware, upload.single('banner'), createEvent);
router.put('/events/:id', authMiddleware, adminMiddleware, upload.single('banner'), updateEvent);
router.delete('/events/:id', authMiddleware, adminMiddleware, deleteEvent);
router.get('/events/:id/attendees', authMiddleware, adminMiddleware, getAttendees);

// =============================================
// ROUTES TICKETS
// =============================================
router.post('/tickets/reserve', authMiddleware, reserveTicket);
router.get('/tickets/check-payment/:txRef', checkPayment);
router.get('/tickets/my', authMiddleware, myTickets);
router.get('/tickets/:uuid', getTicket);
router.get('/tickets/:uuid/download', downloadTicket);

// =============================================
// ROUTES SCANNER & WEBHOOKS
// =============================================
router.post('/verify-ticket', authMiddleware, adminMiddleware, verifyTicket);
router.post('/webhooks/pawapay', express.json(), handlePawaPayWebhook);
router.post('/webhooks/mtn', express.json(), handleMtnWebhook);

// =============================================
// ROUTES ADMIN
// =============================================
router.get('/admin/stats', authMiddleware, adminMiddleware, getAdminStats);

// ✅ Routes Utilisateurs
router.get('/admin/users', authMiddleware, adminMiddleware, getAllUsers);
router.delete('/admin/users/:userId', authMiddleware, adminMiddleware, deleteUser);
router.post('/admin/users/:userId/block', authMiddleware, adminMiddleware, blockUser);
router.post('/admin/users/:userId/unblock', authMiddleware, adminMiddleware, unblockUser);

// ✅ Routes Annonces (CORRIGÉES)
router.post('/admin/announcements', authMiddleware, adminMiddleware, sendAnnouncement);
router.get('/admin/announcements', authMiddleware, adminMiddleware, getAnnouncements);
router.delete('/admin/announcements/:announcementId', authMiddleware, adminMiddleware, deleteAnnouncement);
router.delete('/admin/announcements', authMiddleware, adminMiddleware, deleteAllAnnouncements);

// ✅ Routes Tickets Admin
router.get('/admin/tickets/pending', authMiddleware, adminMiddleware, getPendingTickets);
router.post('/admin/tickets/validate/:txRef', authMiddleware, adminMiddleware, validatePaymentManually);

// ✅ Routes Participants
router.delete('/events/:eventId/attendees/:ticketId', authMiddleware, adminMiddleware, deleteAttendee);
router.delete('/events/:eventId/attendees/:ticketId/hard', authMiddleware, adminMiddleware, hardDeleteAttendee);

module.exports = router;