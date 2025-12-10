/**
 * Shared utilities for microservices - consolidated common functions
 */

const { v4: uuidv4 } = require('uuid');
const { createRedisClient, createPubSubClients } = require('./redis-client');
const { createKafkaClient } = require('./kafka-client');

// Generate unique IDs for documents, users, etc.
const generateId = () => {
  return uuidv4();
};

// Validate document ID format (UUID validation)
const isValidDocumentId = (id) => {
  if (!id || typeof id !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
};

// Sanitize user input (basic XSS protection)
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

// Error handler wrapper for async route handlers
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Create standardized error response
const createErrorResponse = (message, statusCode = 500, data = null) => {
  return createResponse(false, data, message, statusCode);
};

// Validate JWT token format (basic structure validation)
const isValidJWT = (token) => {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  return parts.length === 3;
};

// Enhanced service-to-service HTTP request utility with timeout and error handling
const serviceRequest = async (url, options = {}) => {
  const defaultOptions = {
    timeout: 5000, // 5 second timeout
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Microservice/1.0'
    }
  };

  const mergedOptions = { ...defaultOptions, ...options };

  // Add timeout using AbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), mergedOptions.timeout);

  try {
    const response = await fetch(url, {
      ...mergedOptions,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Service request failed: ${response.status} ${response.statusText}`);
    }

    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Service request timeout');
    }
    throw error;
  }
};

// Validate email format
const isValidEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Hash password (basic implementation - consider using bcrypt in services)
const hashPassword = (password) => {
  // This is a placeholder - services should use proper hashing like bcrypt
  // For now, just return as-is (NOT SECURE - implement proper hashing in auth service)
  return password;
};

// Validate password strength (basic)
const isValidPassword = (password) => {
  if (!password || typeof password !== 'string') return false;
  // At least 8 characters, 1 uppercase, 1 lowercase, 1 number
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/;
  return passwordRegex.test(password);
};

module.exports = {
  generateId,
  isValidDocumentId,
  sanitizeInput,
  createResponse,
  createErrorResponse,
  asyncHandler,
  isValidJWT,
  serviceRequest,
  isValidEmail,
  hashPassword,
  isValidPassword,
  createRedisClient,
  createPubSubClients,
  createKafkaClient
};
