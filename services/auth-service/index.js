require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { v4: uuidv4 } = require('uuid');
const { createResponse, createErrorResponse, asyncHandler, setupMetrics } = require('./shared-utils');
const prisma = require('./shared-utils/prisma-client');
const { validate, registerSchema, loginSchema } = require('./src/utils/validation');
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./src/config/swagger');

const app = express();
const PORT = process.env.PORT || 3001;
const INSTANCE_ID = process.env.INSTANCE_ID || 'auth-1';

// ===================
// MIDDLEWARE
// ===================

// Trust proxy - required for express-rate-limit behind nginx/load balancer
app.set('trust proxy', 1);

// Setup Prometheus metrics (before other middleware)
setupMetrics(app, 'auth-service', INSTANCE_ID);

app.use(cors());
app.use(express.json());
app.use(passport.initialize());

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: createErrorResponse('Too many authentication attempts, please try again after 15 minutes', 429),
  standardHeaders: true,
  legacyHeaders: false,
});

// General rate limiting
const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // limit each IP to 100 requests per minute
  message: createErrorResponse('Too many requests, please try again later', 429),
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(generalLimiter);

// ===================
// GOOGLE OAUTH CONFIG
// ===================
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3001/auth/google/callback'
  },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Find or create user
        let user = await prisma.user.findUnique({
          where: { googleId: profile.id }
        });

        if (!user) {
          // Check if email already exists
          const existingUser = await prisma.user.findUnique({
            where: { email: profile.emails[0].value }
          });

          if (existingUser) {
            // Link Google account to existing user
            user = await prisma.user.update({
              where: { id: existingUser.id },
              data: {
                googleId: profile.id,
                emailVerified: true
              }
            });
          } else {
            // Create new user
            user = await prisma.user.create({
              data: {
                email: profile.emails[0].value,
                name: profile.displayName,
                googleId: profile.id,
                emailVerified: true,
                password: null
              }
            });
          }
        }

        return done(null, user);
      } catch (error) {
        return done(error, null);
      }
    }));
}

// ===================
// HELPER FUNCTIONS
// ===================
const generateTokens = (user) => {
  const accessToken = jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_SECRET || 'default-secret-key',
    { expiresIn: '15m' }
  );

  const refreshToken = uuidv4();

  return { accessToken, refreshToken };
};

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json(createErrorResponse('Access token required', 401));
  }

  jwt.verify(token, process.env.JWT_SECRET || 'default-secret-key', (err, user) => {
    if (err) {
      return res.status(403).json(createErrorResponse('Invalid or expired token', 403));
    }
    req.user = user;
    next();
  });
};

// ===================
// ROUTES
// ===================

// Health check
app.get('/health', (req, res) => {
  res.json(createResponse(true, null, 'Auth service is healthy'));
});

// Swagger
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs));

/**
 * @swagger
 * /register:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - name
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 description: Must have 8+ characters with one uppercase letter, one lowercase letter, one number, and one special character
 *               name:
 *                 type: string
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Validation error (password too weak)
 *       409:
 *         description: User already exists
 */
app.post('/register', authLimiter, validate(registerSchema), asyncHandler(async (req, res) => {
  const { email, password, name } = req.body;

  const existingUser = await prisma.user.findUnique({
    where: { email }
  });

  if (existingUser) {
    return res.status(409).json(createErrorResponse('User already exists', 409));
  }

  const saltRounds = 10;
  const hashedPassword = await bcrypt.hash(password, saltRounds);

  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      name,
      emailVerified: false
    },
    select: {
      id: true,
      email: true,
      name: true,
      emailVerified: true,
      createdAt: true
    }
  });

  res.status(201).json(createResponse(true, user, 'User registered successfully. Please verify your email.'));
}));

/**
 * @swagger
 * /login:
 *   post:
 *     summary: Login a user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful, returns access and refresh tokens
 *       401:
 *         description: Invalid credentials
 */
app.post('/login', authLimiter, validate(loginSchema), asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({
    where: { email }
  });

  if (!user || !user.password) {
    return res.status(401).json(createErrorResponse('Invalid credentials', 401));
  }

  const isValidPassword = await bcrypt.compare(password, user.password);
  if (!isValidPassword) {
    return res.status(401).json(createErrorResponse('Invalid credentials', 401));
  }

  if (!user.emailVerified) {
    return res.status(403).json(createErrorResponse('Email not verified. Please verify your email to login.', 403));
  }

  const { accessToken, refreshToken } = generateTokens(user);

  // Store refresh token
  await prisma.user.update({
    where: { id: user.id },
    data: { refreshToken }
  });

  const userData = {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
    token: accessToken,
    refreshToken
  };

  res.json(createResponse(true, userData, 'Login successful'));
}));

/**
 * @swagger
 * /refresh-token:
 *   post:
 *     summary: Get new access token using refresh token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: New tokens generated
 *       401:
 *         description: Invalid refresh token
 */
app.post('/refresh-token', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(401).json(createErrorResponse('Refresh token required', 401));
  }

  const user = await prisma.user.findFirst({
    where: { refreshToken }
  });

  if (!user) {
    return res.status(401).json(createErrorResponse('Invalid refresh token', 401));
  }

  const tokens = generateTokens(user);

  // Update refresh token (rotation)
  await prisma.user.update({
    where: { id: user.id },
    data: { refreshToken: tokens.refreshToken }
  });

  res.json(createResponse(true, {
    token: tokens.accessToken,
    refreshToken: tokens.refreshToken
  }, 'Tokens refreshed successfully'));
}));

/**
 * @swagger
 * /verify-email:
 *   post:
 *     summary: Mark email as verified (called after EmailJS verification)
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - verificationCode
 *             properties:
 *               email:
 *                 type: string
 *               verificationCode:
 *                 type: string
 *     responses:
 *       200:
 *         description: Email verified successfully
 */
app.post('/verify-email', asyncHandler(async (req, res) => {
  const { email } = req.body;

  // In production, verify the code against stored verification codes
  // For now, we trust the client-side EmailJS verification

  const user = await prisma.user.update({
    where: { email },
    data: { emailVerified: true },
    select: {
      id: true,
      email: true,
      emailVerified: true
    }
  });

  res.json(createResponse(true, user, 'Email verified successfully'));
}));

// ===================
// GOOGLE OAUTH ROUTES
// ===================
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/login' }),
  async (req, res) => {
    const { accessToken, refreshToken } = generateTokens(req.user);

    await prisma.user.update({
      where: { id: req.user.id },
      data: { refreshToken }
    });

    // Redirect to client with tokens
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
    res.redirect(`${clientUrl}/auth/callback?token=${accessToken}&refreshToken=${refreshToken}`);
  }
);

// ===================
// PROTECTED ROUTES
// ===================
app.get('/profile', authenticateToken, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
    select: {
      id: true,
      email: true,
      name: true,
      emailVerified: true,
      createdAt: true
    }
  });

  if (!user) {
    return res.status(404).json(createErrorResponse('User not found', 404));
  }

  res.json(createResponse(true, user, 'Profile retrieved successfully'));
}));

app.get('/users/search', authenticateToken, asyncHandler(async (req, res) => {
  const { q } = req.query;

  if (!q || q.trim().length < 2) {
    return res.status(400).json(createErrorResponse('Search query must be at least 2 characters', 400));
  }

  const users = await prisma.user.findMany({
    where: {
      AND: [
        { id: { not: req.user.userId } },
        {
          OR: [
            { email: { contains: q, mode: 'insensitive' } },
            { name: { contains: q, mode: 'insensitive' } }
          ]
        }
      ]
    },
    select: {
      id: true,
      email: true,
      name: true
    },
    take: 10,
    orderBy: { name: 'asc' }
  });

  res.json(createResponse(true, users, 'Users found'));
}));

app.get('/users/:id', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const user = await prisma.user.findUnique({
    where: { id: parseInt(id) },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true
    }
  });

  if (!user) {
    return res.status(404).json(createErrorResponse('User not found', 404));
  }

  res.json(createResponse(true, user, 'User found'));
}));

// Logout (invalidate refresh token)
app.post('/logout', authenticateToken, asyncHandler(async (req, res) => {
  await prisma.user.update({
    where: { id: req.user.userId },
    data: { refreshToken: null }
  });

  res.json(createResponse(true, null, 'Logged out successfully'));
}));

// ===================
// START SERVER
// ===================
app.listen(PORT, async () => {
  try {
    await prisma.$connect();
    console.log(`Auth service running on port ${PORT}`);
    console.log('Connected to database successfully');
    if (process.env.GOOGLE_CLIENT_ID) {
      console.log('Google OAuth enabled');
    }
  } catch (error) {
    console.error('Failed to connect to database:', error);
    process.exit(1);
  }
});

module.exports = app;
