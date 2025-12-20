const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { createResponse, createErrorResponse, asyncHandler, generateId, serviceRequest, setupMetrics } = require('./shared-utils');
const { prisma, prismaRead } = require('./shared-utils/prisma-client');
const { validate, createDocumentSchema, updateDocumentSchema, addCollaboratorSchema } = require('./src/utils/validation');
const { connectProducer, publishDocumentEvent } = require('./src/utils/kafka-producer');
const { cache, invalidateCache } = require('./src/middleware/cache');
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./src/config/swagger');

const app = express();
const PORT = process.env.PORT || 3002;
const INSTANCE_ID = process.env.INSTANCE_ID || 'doc-1';

// Setup Prometheus metrics
setupMetrics(app, 'document-service', INSTANCE_ID);

// Middleware
app.use(cors());
app.use(express.json());

// Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs));

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
/**
 * @swagger
 * /documents:
 *   get:
 *     summary: Get all documents for the authenticated user
 *     tags: [Documents]
 *     responses:
 *       200:
 *         description: List of documents
 */
app.get('/documents', authenticateToken, asyncHandler(async (req, res) => {
  const documents = await prismaRead.document.findMany({
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

// Get specific document (with caching)
/**
 * @swagger
 * /documents/{id}:
 *   get:
 *     summary: Get a specific document by ID
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Document details
 *       404:
 *         description: Document not found
 */
app.get('/documents/:id', authenticateToken, cache, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const document = await prismaRead.document.findFirst({
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

// Create new document (with validation)
/**
 * @swagger
 * /documents:
 *   post:
 *     summary: Create a new document
 *     tags: [Documents]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               content:
 *                 type: object
 *     responses:
 *       201:
 *         description: Document created successfully
 */
app.post('/documents', authenticateToken, validate(createDocumentSchema), asyncHandler(async (req, res) => {
  const { title, content } = req.body;
  const docId = generateId();

  const document = await prisma.document.create({
    data: {
      id: docId,
      title: title || 'Untitled Document',
      data: content || {},
      ownerId: req.user.userId
    },
    include: {
      collaborators: true
    }
  });

  // Publish event
  await publishDocumentEvent('DOCUMENT_CREATED', {
    documentId: docId,
    userId: req.user.userId,
    title: document.title
  });

  res.status(201).json(createResponse(true, document, 'Document created successfully'));
}));

// Update document (with validation)
/**
 * @swagger
 * /documents/{id}:
 *   put:
 *     summary: Update a document
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               data:
 *                 type: object
 *     responses:
 *       200:
 *         description: Document updated successfully
 *       404:
 *         description: Document not found
 */
app.put('/documents/:id', authenticateToken, validate(updateDocumentSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { title, data } = req.body;

  // Check if document exists and user has access
  const existingDocument = await prismaRead.document.findFirst({
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

  // Invalidate cache
  await invalidateCache(id);

  // Publish event
  await publishDocumentEvent('DOCUMENT_UPDATED', {
    documentId: id,
    userId: req.user.userId,
    updates: { title: !!title, data: !!data }
  });

  res.json(createResponse(true, updatedDocument, 'Document updated successfully'));
}));
/**
 * @swagger
 * /documents/{id}:
 *   put:
 *     summary: Update a document
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               data:
 *                 type: object
 *     responses:
 *       200:
 *         description: Document updated successfully
 *       404:
 *         description: Document not found
 */

// Delete document
/**
 * @swagger
 * /documents/{id}:
 *   delete:
 *     summary: Delete a document
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Document deleted successfully
 *       404:
 *         description: Document not found
 */
app.delete('/documents/:id', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Check if document exists and user is owner
  const existingDocument = await prismaRead.document.findFirst({
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

  // Invalidate cache
  await invalidateCache(id);

  // Publish event
  await publishDocumentEvent('DOCUMENT_DELETED', {
    documentId: id,
    userId: req.user.userId
  });

  res.json(createResponse(true, null, 'Document deleted successfully'));
}));

// Add collaborator to document (with validation)
/**
 * @swagger
 * /documents/{id}/collaborators:
 *   post:
 *     summary: Add a collaborator to a document
 *     tags: [Collaborators]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - role
 *             properties:
 *               userId:
 *                 type: integer
 *               role:
 *                 type: string
 *                 enum: [viewer, editor]
 *     responses:
 *       201:
 *         description: Collaborator added successfully
 *       404:
 *         description: Document not found
 *       409:
 *         description: User is already a collaborator
 */
app.post('/documents/:id/collaborators', authenticateToken, validate(addCollaboratorSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { userId, role } = req.body;

  // Check if document exists and user is owner
  const document = await prismaRead.document.findFirst({
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
    await serviceRequest(`${authServiceUrl}/health`);

  } catch (error) {
    console.error('Auth service communication error:', error);
    return res.status(500).json(createErrorResponse('Unable to validate user', 500));
  }

  const existingCollaborator = await prismaRead.collaborator.findUnique({
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

  await invalidateCache(id);

  await publishDocumentEvent('COLLABORATOR_ADDED', {
    documentId: id,
    addedBy: req.user.userId,
    addedUser: userId,
    role
  });

  res.status(201).json(createResponse(true, collaborator, 'Collaborator added successfully'));
}));
/**
 * @swagger
 * /documents/{id}/collaborators:
 *   post:
 *     summary: Add a collaborator to a document
 *     tags: [Collaborators]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *             properties:
 *               userId:
 *                 type: integer
 *               role:
 *                 type: string
 *                 enum: [viewer, editor]
 *     responses:
 *       201:
 *         description: Collaborator added successfully
 *       404:
 *         description: Document not found
 *       409:
 *         description: User is already a collaborator
 */

/**
 * @swagger
 * /documents/{id}/collaborators/{userId}:
 *   delete:
 *     summary: Remove a collaborator from a document
 *     tags: [Collaborators]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Collaborator removed successfully
 *       404:
 *         description: Document not found
 */
app.delete('/documents/:id/collaborators/:userId', authenticateToken, asyncHandler(async (req, res) => {
  const { id, userId } = req.params;

  // Check if document exists and user is owner
  const document = await prismaRead.document.findFirst({
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

  // Invalidate cache
  await invalidateCache(id);

  // Publish event
  await publishDocumentEvent('COLLABORATOR_REMOVED', {
    documentId: id,
    removedBy: req.user.userId,
    removedUser: userId
  });

  res.json(createResponse(true, null, 'Collaborator removed successfully'));
}));
/**
 * @swagger
 * /documents/{id}/collaborators/{userId}:
 *   delete:
 *     summary: Remove a collaborator from a document
 *     tags: [Collaborators]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Collaborator removed successfully
 *       404:
 *         description: Document not found
 */

// Start server
app.listen(PORT, async () => {
  try {
    console.log(`Document service running on port ${PORT}`);

    // Connect Kafka producer
    await connectProducer();

  } catch (error) {
    console.error('Failed to start service:', error);
    process.exit(1);
  }
});

module.exports = app;
