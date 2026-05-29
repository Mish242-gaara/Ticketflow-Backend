const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const jwt = require('jsonwebtoken');
const database = require('./database');
const pool = database.pool || database;

// ✅ URL de callback sécurisée
const GOOGLE_CALLBACK_URI = process.env.GOOGLE_CALLBACK_URI || 'https://ticketflow-backend-h7m6.onrender.com/api/auth/google/callback';

console.log('🔹 [Passport] GOOGLE_CALLBACK_URI utilisé:', GOOGLE_CALLBACK_URI);

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: GOOGLE_CALLBACK_URI
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      console.log('🔹 [Passport] Callback Google OAuth appelé pour:', profile.emails?.[0]?.value);

      const email = profile.emails?.[0]?.value;
      const googleId = profile.id;
      const name = profile.displayName;
      const avatar = profile.photos?.[0]?.value;

      if (!email) {
        return done(new Error('Email Google non disponible'), null);
      }

      // Recherche de l'utilisateur
      let userRes = await pool.query(
        'SELECT * FROM users WHERE google_id = $1 OR email = $2',
        [googleId, email]
      );

      let user;
      if (userRes.rows.length > 0) {
        user = userRes.rows[0];
        // Mise à jour si l'utilisateur existait sans compte Google
        if (!user.google_id) {
          await pool.query(
            `UPDATE users 
             SET google_id = $1, avatar_url = $2, provider = 'google' 
             WHERE id = $3`,
            [googleId, avatar, user.id]
          );
        }
      } else {
        // Création nouvel utilisateur
        const newUserRes = await pool.query(
          `INSERT INTO users 
           (fullname, email, google_id, avatar_url, provider, password, role) 
           VALUES ($1, $2, $3, $4, 'google', NULL, 'user') 
           RETURNING *`,
          [name, email, googleId, avatar]
        );
        user = newUserRes.rows[0];
      }

      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      return done(null, { user, token });
    } catch (err) {
      console.error('❌ Erreur critique Google OAuth:', err);
      return done(err, null);
    }
  }
));

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

module.exports = passport;