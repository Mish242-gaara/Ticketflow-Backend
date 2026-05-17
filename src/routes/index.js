const express  = require('express');
const router   = express.Router();
const passport = require('../config/passport');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const upload   = require('../middleware/upload');
const { handleFlutterwaveWebhook } = require('../services/paymentService');
const { handleMtnWebhook }         = require('../services/mtnMomoService');

const {
  register, login, me, updateProfile,
  getAllUsers, sendAnnouncement, getAnnouncements,
} = require('../controllers/authController');

const {
  getAllEvents, getEvent, getEventById, createEvent,
  updateEvent, deleteEvent, getAttendees, getAdminEvents,
} = require('../controllers/eventController');

const {
  reserveTicket, checkPayment, myTickets,
  getTicket, downloadTicket, verifyTicket, getAdminStats,
} = require('../controllers/ticketController');

// ── AUTH LOCAL ────────────────────────────────────────────────────────────────
router.post('/auth/register', register);
router.post('/auth/login',    login);
router.get('/auth/me',        authMiddleware, me);
router.put('/auth/profile',   authMiddleware, updateProfile);

// ── GOOGLE OAUTH ──────────────────────────────────────────────────────────────
router.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })
);

router.get('/auth/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/login?error=google' }),
  (req, res) => {
    // Rediriger vers le frontend avec le token dans l'URL
    const { token, user } = req.user;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/auth/callback?token=${token}&user=${encodeURIComponent(JSON.stringify({
      id: user.id, fullname: user.fullname, email: user.email,
      role: user.role, avatar_url: user.avatar_url, provider: user.provider,
    }))}`);
  }
);

// ── EVENTS (public) ───────────────────────────────────────────────────────────
router.get('/events',      getAllEvents);
router.get('/events/:slug', getEvent);

// ── EVENTS (admin) ────────────────────────────────────────────────────────────
router.get('/admin/events',     authMiddleware, adminMiddleware, getAdminEvents);
router.get('/admin/events/:id', authMiddleware, adminMiddleware, getEventById);
router.post('/events',          authMiddleware, adminMiddleware, upload.single('banner'), createEvent);
router.put('/events/:id',       authMiddleware, adminMiddleware, upload.single('banner'), updateEvent);
router.delete('/events/:id',    authMiddleware, adminMiddleware, deleteEvent);
router.get('/events/:id/attendees', authMiddleware, adminMiddleware, getAttendees);

// ── TICKETS (réservation : auth obligatoire) ──────────────────────────────────
router.post('/tickets/reserve',             authMiddleware, reserveTicket);
router.get('/tickets/check-payment/:txRef', checkPayment);
router.get('/tickets/my',                   authMiddleware, myTickets);
router.get('/tickets/:uuid',                getTicket);
router.get('/tickets/:uuid/download',       downloadTicket);

// ── SCANNER (admin only) ──────────────────────────────────────────────────────
router.post('/verify-ticket', authMiddleware, adminMiddleware, verifyTicket);

// ── WEBHOOKS ──────────────────────────────────────────────────────────────────
router.post('/webhooks/flutterwave', express.raw({ type: '*/*' }), handleFlutterwaveWebhook);
router.post('/webhooks/mtn',        express.json(), handleMtnWebhook);

// ── ADMIN : STATS + USERS + ANNONCES ─────────────────────────────────────────
router.get('/admin/stats',          authMiddleware, adminMiddleware, getAdminStats);
router.get('/admin/users',          authMiddleware, adminMiddleware, getAllUsers);
router.post('/admin/announcements', authMiddleware, adminMiddleware, sendAnnouncement);
router.get('/admin/announcements',  authMiddleware, adminMiddleware, getAnnouncements);

module.exports = router;
