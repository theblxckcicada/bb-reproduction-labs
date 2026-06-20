const bcrypt = require('bcryptjs');
const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const config = require('./config');
const db = require('./db');

const passwordRules = {
  minLength: 8
};

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    emailVerified: user.emailVerified,
    providers: Object.keys(user.providerLinks || {}),
    createdAt: user.createdAt
  };
}

async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

async function verifyPassword(password, passwordHash) {
  if (!passwordHash) return false;
  return bcrypt.compare(password, passwordHash);
}

function requireAuth(req, res, next) {
  const user = db.findUserById(req.session.userId);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  req.user = user;
  return next();
}

function validateRegistration(input) {
  const displayName = String(input.displayName || '').trim();
  const email = db.normalizeEmail(input.email);
  const password = String(input.password || '');

  if (!displayName) {
    const err = new Error('Name is required.');
    err.statusCode = 400;
    throw err;
  }

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    const err = new Error('A valid email is required.');
    err.statusCode = 400;
    throw err;
  }

  if (password.length < passwordRules.minLength) {
    const err = new Error(`Password must be at least ${passwordRules.minLength} characters.`);
    err.statusCode = 400;
    throw err;
  }

  return { displayName, email, password };
}

function validateLogin(input) {
  const email = db.normalizeEmail(input.email);
  const password = String(input.password || '');

  if (!/^\S+@\S+\.\S+$/.test(email) || !password) {
    const err = new Error('Invalid email or password.');
    err.statusCode = 401;
    throw err;
  }

  return { email, password };
}

function configurePassport() {
  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser((id, done) => done(null, db.findUserById(id)));

  if (!config.google.clientId || !config.google.clientSecret) {
    return;
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID: config.google.clientId,
        clientSecret: config.google.clientSecret,
        callbackURL: `${config.baseUrl}${config.google.callbackPath}`
      },
      (accessToken, refreshToken, profile, done) => {
        try {
          const email = db.normalizeEmail(profile.emails && profile.emails[0] && profile.emails[0].value);
          if (!email) return done(new Error('Google profile did not include an email address.'));

          const photo = profile.photos && profile.photos[0] && profile.photos[0].value;
          let user = db.findUserByEmail(email);

          if (user) {
            user = db.updateUser(user.id, (current) => ({
              displayName: current.displayName || profile.displayName || email.split('@')[0],
              avatarUrl: photo || current.avatarUrl,
              emailVerified: true,
              providerLinks: {
                ...(current.providerLinks || {}),
                google: profile.id
              }
            }));
          } else {
            user = db.createUser({
              email,
              displayName: profile.displayName || email.split('@')[0],
              avatarUrl: photo || null,
              emailVerified: true,
              providerLinks: { google: profile.id },
              passwordHash: null
            });
          }

          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    )
  );
}

module.exports = {
  configurePassport,
  hashPassword,
  verifyPassword,
  requireAuth,
  validateRegistration,
  validateLogin,
  publicUser
};
