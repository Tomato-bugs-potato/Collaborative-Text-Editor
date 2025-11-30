const { v4: uuidv4 } = require('uuid');
const { createRedisClient } = require('./redis-client');
const prisma = require('./prisma-client');

/**
 * Shared utilities for microservices
 */

// Generate unique IDs for documents, users, etc.
const generateId = () => {
  return uuidv4();
};

// Validate document ID format
const isValidDocumentId = (id) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
};

// Sanitize user input
const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;
  return input.trim().replace(/[<>]/g, '');
};

// Create standardized API response
const createResponse = (success, data = null, message = '', statusCode = 200) => {
  return {
    success,
    data,
    message,
    timestamp: new Date().toISOString(),
    statusCode
  };
};

// Error handler wrapper
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Create standardized error response
const createErrorResponse = (message, statusCode = 500, data = null) => {
  return createResponse(false, data, message, statusCode);
};

// Validate JWT token format
const isValidJWT = (token) => {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  return parts.length === 3;
};

module.exports = {
  generateId,
  isValidDocumentId,
  sanitizeInput,
  createResponse,
  createErrorResponse,
  asyncHandler,
  isValidJWT,
  createRedisClient,
  prisma
};
