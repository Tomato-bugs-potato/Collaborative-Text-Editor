const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(helmet());
app.use(express.json());

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

// Authentication middleware
const authenticateRequest = (req, res, next) => {
  // In a real implementation, validate JWT tokens
  // For now, just pass through
  next();
};

// Route requests to Auth Service
app.use('/api/auth', createProxyMiddleware({
  target: process.env.AUTH_SERVICE_URL || 'http://localhost:3001',
  changeOrigin: true,
  pathRewrite: {
    '^/api/auth': '' // Remove /api/auth prefix when forwarding
  }
}));

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
