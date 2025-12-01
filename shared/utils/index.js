/**
 * Shared utilities for microservices - lightweight functions only
 */

// Generate unique IDs for documents, users, etc.
const generateId = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

// Validate document ID format (basic UUID validation)
const isValidDocumentId = (id) => {
  if (!id || typeof id !== 'string') return false;
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

// Service-to-service communication utility
const serviceRequest = async (serviceUrl, method = 'GET', data = null, headers = {}) => {
  const requestOptions = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  };

  if (data) {
    requestOptions.body = JSON.stringify(data);
  }

  const response = await fetch(serviceUrl, requestOptions);

  if (!response.ok) {
    throw new Error(`Service request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
};

module.exports = {
  generateId,
  isValidDocumentId,
  sanitizeInput,
  createResponse,
  createErrorResponse,
  asyncHandler,
  isValidJWT,
  serviceRequest
};
