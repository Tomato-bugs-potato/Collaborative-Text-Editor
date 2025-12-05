const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const url = require('url');

const app = express();
const PORT = process.env.PORT || 4000;

// Parse service URLs with fallback defaults
const authServices = (process.env.AUTH_SERVICE_URL || 'http://auth-service-1:3001').split(',').map(u => u.trim());
const documentServices = (process.env.DOCUMENT_SERVICE_URL || 'http://document-service-1:3002').split(',').map(u => u.trim());
const collaborationServices = (process.env.COLLABORATION_SERVICE_URL || 'http://collaboration-service-1:3003').split(',').map(u => u.trim());

// Load balancing counters
let authIndex = 0;
let documentIndex = 0;
let collaborationIndex = 0;

// Middleware
app.use(cors());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'api-gateway',
    timestamp: new Date().toISOString()
  });
});

// JWT Authentication middleware
const authenticateRequest = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      error: 'Access token required',
      message: 'Please provide a valid JWT token in the Authorization header'
    });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'default-secret-key', (err, user) => {
    if (err) {
      return res.status(403).json({
        error: 'Invalid or expired token',
        message: 'The provided JWT token is invalid or has expired'
      });
    }
    req.user = user;
    next();
  });
};

// Auth Service proxy (no authentication required)
app.use('/api/auth', createProxyMiddleware({
  target: authServices[0], // Default target
  router: () => {
    const target = authServices[authIndex % authServices.length];
    authIndex++;
    console.log(`[API Gateway] Routing to auth service: ${target}`);
    return url.parse(target);
  },
  changeOrigin: true,
  pathRewrite: {
    '^/api/auth': ''
  }
}));

// Document Service proxy (requires authentication)
app.use('/api/documents', authenticateRequest, createProxyMiddleware({
  target: documentServices[0], // Default target
  router: () => {
    const target = documentServices[documentIndex % documentServices.length];
    documentIndex++;
    console.log(`[API Gateway] Routing to document service: ${target}`);
    return url.parse(target);
  },
  changeOrigin: true,
  pathRewrite: {
    '^/api/documents': '/documents'
  }
}));

// WebSocket proxy for Collaboration Service
app.use('/socket.io', createProxyMiddleware({
  target: collaborationServices[0], // Default target
  router: () => {
    const target = collaborationServices[collaborationIndex % collaborationServices.length];
    collaborationIndex++;
    console.log(`[API Gateway] Routing to collaboration service: ${target}`);
    return url.parse(target);
  },
  changeOrigin: true,
  ws: true
}));

// Catch-all route
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.originalUrl} not found`,
    availableRoutes: [
      '/health',
      '/api/auth/*',
      '/api/documents/*',
      '/socket.io/*'
    ]
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('API Gateway Error:', err);
  console.error('Stack:', err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: 'Something went wrong in the API Gateway'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
  console.log('Routing requests to:');
  console.log(`  Auth Services: ${authServices.join(', ')}`);
  console.log(`  Document Services: ${documentServices.join(', ')}`);
  console.log(`  Collaboration Services: ${collaborationServices.join(', ')}`);
});

module.exports = app;
