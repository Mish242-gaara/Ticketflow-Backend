const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const jwt = require('jsonwebtoken');
const { pool } = require('./database');

passport.use(new GoogleStrategy({
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:  process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/api/auth/google/callback',
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const email    = profile.emails?.[0]?.value;
      const googleId = profile.id;
      const name     = profile.displayName;
      const avatar   = profile.photos?.[0]?.value;

      if (!email) return done(new Error('Email Google non disponible'), null);

      // Chercher utilisateur existant par google_id ou email
      let userRes = await pool.query(
        'SELECT * FROM users WHERE google_id=$1 OR email=$2',
        [googleId, email]
      );

      let user;
      if (userRes.rows.length) {
        // Mettre à jour google_id si connexion par email existant
        user = userRes.rows[0];
        if (!user.google_id) {
          await pool.query(
            'UPDATE users SET google_id=$1, avatar_url=$2, provider=$3 WHERE id=$4',
            [googleId, avatar, 'google', user.id]
          );
        }
      } else {
        // Créer nouveau compte via Google
        const res = await pool.query(`
          INSERT INTO users (fullname, email, google_id, avatar_url, provider, password)
          VALUES ($1,$2,$3,$4,'google',NULL) RETURNING *
        `, [name, email, googleId, avatar]);
        user = res.rows[0];
      }

      // Générer JWT
      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      return done(null, { user, token });
    } catch (err) {
      return done(err, null);
    }
  }
));

module.exports = passport;
