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

// Contrôleurs Auth
const {
  register,
  login,
  me,
  updateProfile,
  getAllUsers,       // ✅ Gardé ici (si lié à l'auth)
  sendAnnouncement,  // ✅ À déplacer dans announcementController si logique métier différente
  getAnnouncements    // ✅ À déplacer dans announcementController si logique métier différente
} = require('../controllers/authController');

// ✅ Contrôleurs Utilisateurs (NOUVEAU FICHIER)
const {
  deleteUser,
  blockUser,
  unblockUser
} = require('../controllers/userController');

// ✅ Contrôleurs Annonces (NOUVEAU FICHIER)
const {
  deleteAnnouncement,
  deleteAllAnnouncements
} = require('../controllers/announcementController');

// Contrôleurs Events
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

// Contrôleurs Tickets
const {
  reserveTicket,
  checkPayment,
  myTickets,
  getTicket,
  downloadTicket,
  verifyTicket,
  getAdminStats,
  validatePaymentManually,
  getPendingTickets,
  checkFreeTicket
} = require('../controllers/ticketController');

// =============================================
// ROUTES AUTH
// =============================================
router.post('/auth/register', register);
router.post('/auth/login', login);
router.get('/auth/me', authMiddleware, me);
router.put('/auth/profile', authMiddleware, updateProfile);

// Google OAuth
router.get('/auth/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    redirect_uri: process.env.GOOGLE_CALLBACK_URI
  })
);

router.get('/auth/google/callback',
  passport.authenticate('google', {
    failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?error=google`
  }),
  (req, res) => {
    if (!req.user || !req.user.token || !req.user.user) {
      console.error('❌ Erreur : req.user est vide ou incomplet');
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?error=google_incomplete`);
    }
    const { token, user } = req.user;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/auth/callback?token=${token}&user=${encodeURIComponent(JSON.stringify(user))}`);
  }
);

// =============================================
// ROUTES EVENTS
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
// ROUTES SCANNER
// =============================================
router.post('/verify-ticket', authMiddleware, adminMiddleware, verifyTicket);

// =============================================
// ROUTES WEBHOOKS
// =============================================
router.post('/webhooks/pawapay', express.json(), handlePawaPayWebhook);
router.post('/webhooks/mtn', express.json(), handleMtnWebhook);

// =============================================
// ROUTES ADMIN
// =============================================
router.get('/admin/stats', authMiddleware, adminMiddleware, getAdminStats);

// ✅ Routes Utilisateurs (importées depuis userController.js)
router.get('/admin/users', authMiddleware, adminMiddleware, getAllUsers);
router.delete('/admin/users/:userId', authMiddleware, adminMiddleware, deleteUser);
router.post('/admin/users/:userId/block', authMiddleware, adminMiddleware, blockUser);
router.post('/admin/users/:userId/unblock', authMiddleware, adminMiddleware, unblockUser);

// ✅ Routes Annonces (importées depuis announcementController.js)
router.post('/admin/announcements', authMiddleware, adminMiddleware, sendAnnouncement);
router.get('/admin/announcements', authMiddleware, adminMiddleware, getAnnouncements);
router.delete('/admin/announcements/:announcementId', authMiddleware, adminMiddleware, deleteAnnouncement);
router.delete('/admin/announcements', authMiddleware, adminMiddleware, deleteAllAnnouncements);

// Validation des paiements
router.get('/admin/tickets/pending', authMiddleware, adminMiddleware, getPendingTickets);
router.post('/admin/tickets/validate/:txRef', authMiddleware, adminMiddleware, validatePaymentManually);

// Suppression de participants
router.delete('/events/:eventId/attendees/:ticketId', authMiddleware, adminMiddleware, deleteAttendee);
router.delete('/events/:eventId/attendees/:ticketId/hard', authMiddleware, adminMiddleware, hardDeleteAttendee);

module.exports = router;