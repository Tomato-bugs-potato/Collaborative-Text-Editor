const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { createResponse, createErrorResponse, asyncHandler } = require('./shared-utils');
const prisma = require('./shared-utils/prisma-client');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json(createResponse(true, null, 'Auth service is healthy'));
});

// Register endpoint
app.post('/register', asyncHandler(async (req, res) => {
  const { email, password, name } = req.body;

  // Validate input
  if (!email || !password || !name) {
    return res.status(400).json(createErrorResponse('Email, password, and name are required', 400));
  }

  // Check if user exists
  const existingUser = await prisma.user.findUnique({
    where: { email }
  });

  if (existingUser) {
    return res.status(409).json(createErrorResponse('User already exists', 409));
  }

  // Hash password
  const saltRounds = 10;
  const hashedPassword = await bcrypt.hash(password, saltRounds);

  // Create user
  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      name
    },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true
    }
  });

  res.status(201).json(createResponse(true, user, 'User registered successfully'));
}));

// Login endpoint
app.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return res.status(400).json(createErrorResponse('Email and password are required', 400));
  }

  // Find user
  const user = await prisma.user.findUnique({
    where: { email }
  });

  if (!user) {
    return res.status(401).json(createErrorResponse('Invalid credentials', 401));
  }

  // Check password
  const isValidPassword = await bcrypt.compare(password, user.password);
  if (!isValidPassword) {
    return res.status(401).json(createErrorResponse('Invalid credentials', 401));
  }

  // Generate JWT
  const token = jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_SECRET || 'default-secret-key',
    { expiresIn: '24h' }
  );

  // Return user data and token
  const userData = {
    id: user.id,
    email: user.email,
    name: user.name,
    token
  };

  res.json(createResponse(true, userData, 'Login successful'));
}));

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

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

// Protected route example
app.get('/profile', authenticateToken, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
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

  res.json(createResponse(true, user, 'Profile retrieved successfully'));
}));

// Search users by email or name
app.get('/users/search', authenticateToken, asyncHandler(async (req, res) => {
  const { q } = req.query;

  if (!q || q.trim().length < 2) {
    return res.status(400).json(createErrorResponse('Search query must be at least 2 characters', 400));
  }

  const users = await prisma.user.findMany({
    where: {
      AND: [
        { id: { not: req.user.userId } }, // Exclude current user
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
    take: 10, // Limit results
    orderBy: { name: 'asc' }
  });

  res.json(createResponse(true, users, 'Users found'));
}));

// Get user by ID
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

// Start server
app.listen(PORT, async () => {
  try {
    await prisma.$connect();
    console.log(`Auth service running on port ${PORT}`);
    console.log('Connected to database successfully');
  } catch (error) {
    console.error('Failed to connect to database:', error);
    process.exit(1);
  }
});

module.exports = app;
