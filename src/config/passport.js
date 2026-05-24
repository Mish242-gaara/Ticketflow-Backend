const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const jwt = require('jsonwebtoken');
const database = require('./database');
const pool = database.pool || database;

// ✅ Vérifie que GOOGLE_CALLBACK_URI est bien défini
const GOOGLE_CALLBACK_URI = process.env.GOOGLE_CALLBACK_URI;
console.log('🔹 [Passport] GOOGLE_CALLBACK_URI:', GOOGLE_CALLBACK_URI);

if (!GOOGLE_CALLBACK_URI) {
  console.error('❌ GOOGLE_CALLBACK_URI est manquant dans les variables d\'environnement de Render !');
  console.error('   → Définissez-le dans Render → Settings → Environment Variables');
  // ✅ Ne pas planter en production (pour éviter un crash)
  // throw new Error('GOOGLE_CALLBACK_URI est manquant !');
}

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: GOOGLE_CALLBACK_URI,
    scope: ['profile', 'email'],
    state: true
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      console.log('🔹 [Passport] Callback Google OAuth appelé');

      const email = profile.emails?.[0]?.value;
      const googleId = profile.id;
      const name = profile.displayName;
      const avatar = profile.photos?.[0]?.value;

      if (!email) {
        return done(new Error('Email Google non disponible'), null);
      }

      let userRes = await pool.query(
        'SELECT * FROM users WHERE google_id = $1 OR email = $2',
        [googleId, email]
      );

      let user;
      if (userRes.rows.length > 0) {
        user = userRes.rows[0];
        if (!user.google_id) {
          await pool.query(
            `UPDATE users
             SET google_id = $1, avatar_url = $2, provider = $3
             WHERE id = $4`,
            [googleId, avatar, 'google', user.id]
          );
        }
      } else {
        const newUserRes = await pool.query(
          `INSERT INTO users
           (fullname, email, google_id, avatar_url, provider, password, role)
           VALUES ($1, $2, $3, $4, $5, NULL, 'user')
           RETURNING *`,
          [name, email, googleId, avatar, 'google']
        );
        user = newUserRes.rows[0];
      }

      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      );

      return done(null, { user, token });
    } catch (err) {
      console.error('❌ Erreur Google OAuth:', err);
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