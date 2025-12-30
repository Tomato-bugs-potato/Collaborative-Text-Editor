const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { createResponse, createErrorResponse, asyncHandler, generateId, serviceRequest, setupMetrics } = require('./shared-utils');
const { prisma, prismaRead } = require('./shared-utils/prisma-client');
const { validate, createDocumentSchema, updateDocumentSchema, addCollaboratorSchema } = require('./src/utils/validation');
const { connectProducer, publishDocumentEvent, publishSnapshot } = require('./src/utils/kafka-producer');
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

  if (!token) return res.status(401).json(createErrorResponse('Access token required', 401));

  jwt.verify(token, process.env.JWT_SECRET || 'default-secret-key', (err, user) => {
    if (err) return res.status(403).json(createErrorResponse('Invalid or expired token', 403));
    req.user = user;
    next();
  });
};

// Health check
app.get('/health', (req, res) => {
  res.json(createResponse(true, null, 'Document service is healthy'));
});

// Get all documents
app.get('/documents', authenticateToken, asyncHandler(async (req, res) => {
  const documents = await prismaRead.document.findMany({
    where: {
      OR: [
        { ownerId: req.user.userId },
        { collaborators: { some: { userId: req.user.userId } } }
      ]
    },
    include: { collaborators: true },
    orderBy: { lastModified: 'desc' }
  });

  res.json(createResponse(true, documents, 'Documents retrieved successfully'));
}));

// Get specific document
app.get('/documents/:id', authenticateToken, cache, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const document = await prismaRead.document.findFirst({
    where: {
      id,
      OR: [
        { ownerId: req.user.userId },
        { collaborators: { some: { userId: req.user.userId } } }
      ]
    },
    include: { collaborators: true }
  });

  if (!document) return res.status(404).json(createErrorResponse('Document not found or access denied', 404));

  res.json(createResponse(true, document, 'Document retrieved successfully'));
}));

// Create document
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
    include: { collaborators: true }
  });

  await publishDocumentEvent('DOCUMENT_CREATED', {
    documentId: docId,
    userId: req.user.userId,
    title: document.title
  });

  res.status(201).json(createResponse(true, document, 'Document created successfully'));
}));

// Update document with snapshot publishing
app.put('/documents/:id', authenticateToken, validate(updateDocumentSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { title, data } = req.body;

  const existingDocument = await prismaRead.document.findFirst({
    where: {
      id,
      OR: [
        { ownerId: req.user.userId },
        { collaborators: { some: { userId: req.user.userId, role: { in: ['editor', 'owner'] } } } }
      ]
    }
  });

  if (!existingDocument) return res.status(404).json(createErrorResponse('Document not found or access denied', 404));

  const updatedDocument = await prisma.document.update({
    where: { id },
    data: {
      title: title !== undefined ? title : existingDocument.title,
      data: data !== undefined ? data : existingDocument.data,
      lastModified: new Date()
    },
    include: { collaborators: true }
  });

  await invalidateCache(id);

  await publishDocumentEvent('DOCUMENT_UPDATED', {
    documentId: id,
    userId: req.user.userId,
    updates: { title: !!title, data: !!data }
  });

  // Publish snapshot
  if (data) {
    await publishSnapshot({
      documentId: id,
      version: updatedDocument.version,
      data: updatedDocument.data,
      userId: req.user.userId
    });
  }

  res.json(createResponse(true, updatedDocument, 'Document updated successfully'));
}));

// Delete document
app.delete('/documents/:id', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existingDocument = await prismaRead.document.findFirst({ where: { id, ownerId: req.user.userId } });
  if (!existingDocument) return res.status(404).json(createErrorResponse('Document not found or not authorized to delete', 404));

  await prisma.document.delete({ where: { id } });
  await invalidateCache(id);

  await publishDocumentEvent('DOCUMENT_DELETED', { documentId: id, userId: req.user.userId });

  res.json(createResponse(true, null, 'Document deleted successfully'));
}));

// Add collaborator
app.post('/documents/:id/collaborators', authenticateToken, validate(addCollaboratorSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { userId, role } = req.body;

  const document = await prismaRead.document.findFirst({ where: { id, ownerId: req.user.userId } });
  if (!document) return res.status(404).json(createErrorResponse('Document not found or not authorized', 404));

  try { const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:3001'; await serviceRequest(`${authServiceUrl}/health`); } catch (error) { console.error('Auth service error:', error); return res.status(500).json(createErrorResponse('Unable to validate user', 500)); }

  const existingCollaborator = await prismaRead.collaborator.findUnique({ where: { documentId_userId: { documentId: id, userId: parseInt(userId) } } });
  if (existingCollaborator) return res.status(409).json(createErrorResponse('User is already a collaborator', 409));

  const collaborator = await prisma.collaborator.create({ data: { documentId: id, userId: parseInt(userId), role } });
  await invalidateCache(id);

  await publishDocumentEvent('COLLABORATOR_ADDED', { documentId: id, addedBy: req.user.userId, addedUser: userId, role });

  res.status(201).json(createResponse(true, collaborator, 'Collaborator added successfully'));
}));

// Remove collaborator
app.delete('/documents/:id/collaborators/:userId', authenticateToken, asyncHandler(async (req, res) => {
  const { id, userId } = req.params;
  const document = await prismaRead.document.findFirst({ where: { id, ownerId: req.user.userId } });
  if (!document) return res.status(404).json(createErrorResponse('Document not found or not authorized', 404));

  await prisma.collaborator.delete({ where: { documentId_userId: { documentId: id, userId: parseInt(userId) } } });
  await invalidateCache(id);

  await publishDocumentEvent('COLLABORATOR_REMOVED', { documentId: id, removedBy: req.user.userId, removedUser: userId });

  res.json(createResponse(true, null, 'Collaborator removed successfully'));
}));

// List snapshots
app.get('/documents/:id/snapshots', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const storageServiceUrl = process.env.STORAGE_SERVICE_URL || 'http://localhost:3006';

  try {
    const response = await serviceRequest(`${storageServiceUrl}/documents/${id}/snapshots`);
    const data = await response.json();
    res.json(createResponse(true, data.snapshots, 'Snapshots retrieved successfully'));
  } catch (error) {
    console.error('Error fetching snapshots:', error);
    res.status(500).json(createErrorResponse('Failed to fetch snapshots', 500));
  }
}));

// Revert document to snapshot
app.post('/documents/:id/revert', authenticateToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { snapshotKey } = req.body;
  if (!snapshotKey) return res.status(400).json(createErrorResponse('Snapshot key is required', 400));

  const existingDocument = await prismaRead.document.findFirst({
    where: {
      id,
      OR: [
        { ownerId: req.user.userId },
        { collaborators: { some: { userId: req.user.userId, role: 'editor' } } }
      ]
    }
  });

  if (!existingDocument) return res.status(404).json(createErrorResponse('Document not found or access denied', 404));

  const storageServiceUrl = process.env.STORAGE_SERVICE_URL || 'http://localhost:3006';
  let snapshotData;
  try {
    const response = await serviceRequest(`${storageServiceUrl}/internal/snapshots/${snapshotKey}`);
    snapshotData = await response.json();
  } catch (error) {
    console.error('Error fetching snapshot content:', error);
    return res.status(500).json(createErrorResponse('Failed to retrieve snapshot content', 500));
  }

  if (!snapshotData || !snapshotData.data) return res.status(400).json(createErrorResponse('Invalid snapshot data', 400));

  const updatedDocument = await prisma.document.update({
    where: { id },
    data: { data: snapshotData.data, lastModified: new Date() }
  });

  await invalidateCache(id);

  await publishDocumentEvent('DOCUMENT_UPDATED', {
    documentId: id,
    userId: req.user.userId,
    updates: { reverted: true, fromVersion: snapshotData.version }
  });

  res.json(createResponse(true, updatedDocument, 'Document reverted successfully'));
}));

// Start server
app.listen(PORT, async () => {
  try {
    console.log(`Document service running on port ${PORT}`);
    await connectProducer();
  } catch (error) {
    console.error('Failed to start service:', error);
    process.exit(1);
  }
});

module.exports = app;