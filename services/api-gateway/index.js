const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'api-gateway',
    timestamp: new Date().toISOString(),
    services: {
      auth: process.env.AUTH_SERVICE_URL || 'http://localhost:3001',
      document: process.env.DOCUMENT_SERVICE_URL || 'http://localhost:3002',
      collaboration: process.env.COLLABORATION_SERVICE_URL || 'http://localhost:3003'
    }
  });
});

// Manual proxy to Auth Service
app.use('/api/auth', (req, res) => {
  console.log(`[API Gateway] Manual proxy: ${req.method} ${req.originalUrl}`);

  // Remove /api/auth prefix
  const targetPath = req.originalUrl.replace('/api/auth', '');

  const options = {
    hostname: 'auth-service',
    port: 3001,
    path: targetPath,
    method: req.method,
    headers: {
      ...req.headers,
      host: 'auth-service:3001'
    }
  };

  const proxyReq = require('http').request(options, (proxyRes) => {
    console.log(`[API Gateway] Response: ${proxyRes.statusCode}`);
    res.status(proxyRes.statusCode);

    // Copy headers
    Object.keys(proxyRes.headers).forEach(key => {
      res.setHeader(key, proxyRes.headers[key]);
    });

    // Pipe response
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('[API Gateway] Proxy error:', err.message);
    res.status(500).json({ error: 'Proxy error', message: err.message });
  });

  // Pipe request body if present
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
});

// Request logging
app.use((req, res, next) => {
  console.log(`[API Gateway] Unhandled ${req.method} ${req.originalUrl}`);
  next();
});

// JWT Authentication middleware
const authenticateRequest = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

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
    req.user = user; // Attach user info to request
    next();
  });
};

// Route requests to Document Service
app.use('/api/documents', authenticateRequest, createProxyMiddleware({
  target: process.env.DOCUMENT_SERVICE_URL || 'http://localhost:3002',
  changeOrigin: true,
  pathRewrite: {
    '^/api/documents': '' // Remove /api/documents prefix when forwarding
  }
}));

// Route WebSocket connections to Collaboration Service
app.use('/socket.io', createProxyMiddleware({
  target: process.env.COLLABORATION_SERVICE_URL || 'http://localhost:3003',
  changeOrigin: true,
  ws: true // Enable WebSocket proxying
}));

// Catch-all route for unmatched requests
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
  res.status(500).json({
    error: 'Internal Server Error',
    message: 'Something went wrong in the API Gateway'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
  console.log('Routing requests to:');
  console.log(`  Auth Service: ${process.env.AUTH_SERVICE_URL || 'http://localhost:3001'}`);
  console.log(`  Document Service: ${process.env.DOCUMENT_SERVICE_URL || 'http://localhost:3002'}`);
  console.log(`  Collaboration Service: ${process.env.COLLABORATION_SERVICE_URL || 'http://localhost:3003'}`);
});

module.exports = app;
