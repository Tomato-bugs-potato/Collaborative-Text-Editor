const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { createResponse, createErrorResponse, asyncHandler, generateId, serviceRequest } = require('./shared/utils');

const prisma = new PrismaClient({
  log: ['error', 'warn'],
});

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(cors());
app.use(express.json());

// JWT authentication middleware
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

// Health check
app.get('/health', (req, res) => {
  res.json(createResponse(true, null, 'Document service is healthy'));
});

// Get all documents for authenticated user
app.get('/documents', authenticateToken, asyncHandler(async (req, res) => {
  const documents = await prisma.document.findMany({
    where: {
      OR: [
        { ownerId: req.user.userId },
        {
          collaborators: {
            some: {
              userId: req.user.userId
            }
          }
        }
      ]
    },
    include: {
      collaborators: true
    },
    orderBy: {
      lastModified: 'desc'
    }
  });

  res.json(createResponse(true, documents, 'Documents retrieved successfully'));
}));

// Get specific document
app.get('/documents/:id', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const document = await prisma.document.findFirst({
    where: {
      id,
      OR: [
        { ownerId: req.user.userId },
        {
          collaborators: {
            some: {
              userId: req.user.userId
            }
          }
        }
      ]
    },
    include: {
      collaborators: true
    }
  });

  if (!document) {
    return res.status(404).json(createErrorResponse('Document not found or access denied', 404));
  }

  res.json(createResponse(true, document, 'Document retrieved successfully'));
}));

// Create new document
app.post('/documents', authenticateToken, asyncHandler(async (req, res) => {
  const { title, content } = req.body;

  const document = await prisma.document.create({
    data: {
      id: generateId(),
      title: title || 'Untitled Document',
      data: content || {},
      ownerId: req.user.userId
    },
    include: {
      collaborators: true
    }
  });

  res.status(201).json(createResponse(true, document, 'Document created successfully'));
}));

// Update document
app.put('/documents/:id', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { title, data } = req.body;

  // Check if document exists and user has access
  const existingDocument = await prisma.document.findFirst({
    where: {
      id,
      OR: [
        { ownerId: req.user.userId },
        {
          collaborators: {
            some: {
              userId: req.user.userId,
              role: { in: ['editor', 'owner'] }
            }
          }
        }
      ]
    }
  });

  if (!existingDocument) {
    return res.status(404).json(createErrorResponse('Document not found or access denied', 404));
  }

  // Update document
  const updatedDocument = await prisma.document.update({
    where: { id },
    data: {
      title: title !== undefined ? title : existingDocument.title,
      data: data !== undefined ? data : existingDocument.data,
      lastModified: new Date()
    },
    include: {
      collaborators: true
    }
  });

  res.json(createResponse(true, updatedDocument, 'Document updated successfully'));
}));

// Delete document
app.delete('/documents/:id', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Check if document exists and user is owner
  const existingDocument = await prisma.document.findFirst({
    where: {
      id,
      ownerId: req.user.userId
    }
  });

  if (!existingDocument) {
    return res.status(404).json(createErrorResponse('Document not found or not authorized to delete', 404));
  }

  // Delete document (cascade will delete collaborators)
  await prisma.document.delete({
    where: { id }
  });

  res.json(createResponse(true, null, 'Document deleted successfully'));
}));

// Add collaborator to document
app.post('/documents/:id/collaborators', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { userId, role = 'editor' } = req.body;

  if (!userId) {
    return res.status(400).json(createErrorResponse('User ID is required', 400));
  }

  // Check if document exists and user is owner
  const document = await prisma.document.findFirst({
    where: {
      id,
      ownerId: req.user.userId
    }
  });

  if (!document) {
    return res.status(404).json(createErrorResponse('Document not found or not authorized', 404));
  }

  // Validate that the user to be added exists (service-to-service call)
  try {
    const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
    await serviceRequest(`${authServiceUrl}/health`); // Basic connectivity check

    // In a real implementation, you'd call an endpoint like /api/auth/users/:userId
    // For now, we'll assume the user exists if the ID is provided
  } catch (error) {
    console.error('Auth service communication error:', error);
    return res.status(500).json(createErrorResponse('Unable to validate user', 500));
  }

  // Check if user is already a collaborator
  const existingCollaborator = await prisma.collaborator.findUnique({
    where: {
      documentId_userId: {
        documentId: id,
        userId: parseInt(userId)
      }
    }
  });

  if (existingCollaborator) {
    return res.status(409).json(createErrorResponse('User is already a collaborator', 409));
  }

  // Add collaborator
  const collaborator = await prisma.collaborator.create({
    data: {
      documentId: id,
      userId: parseInt(userId),
      role
    }
  });

  res.status(201).json(createResponse(true, collaborator, 'Collaborator added successfully'));
}));

// Remove collaborator from document
app.delete('/documents/:id/collaborators/:userId', authenticateToken, asyncHandler(async (req, res) => {
  const { id, userId } = req.params;

  // Check if document exists and user is owner
  const document = await prisma.document.findFirst({
    where: {
      id,
      ownerId: req.user.userId
    }
  });

  if (!document) {
    return res.status(404).json(createErrorResponse('Document not found or not authorized', 404));
  }

  // Remove collaborator
  await prisma.collaborator.delete({
    where: {
      documentId_userId: {
        documentId: id,
        userId: parseInt(userId)
      }
    }
  });

  res.json(createResponse(true, null, 'Collaborator removed successfully'));
}));

// Start server
app.listen(PORT, async () => {
  try {
    await prisma.$connect();
    console.log(`Document service running on port ${PORT}`);
    console.log('Connected to database successfully');
  } catch (error) {
    console.error('Failed to connect to database:', error);
    process.exit(1);
  }
});

module.exports = app;
