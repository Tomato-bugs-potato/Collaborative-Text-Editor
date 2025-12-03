require("dotenv").config();
const express = require('express');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { createRedisClient } = require('../shared-utils/redis-client');
const prisma = require('../shared-utils/prisma-client');

const app = express();
const PORT = process.env.PORT || 3003;

// Create Redis clients for pub/sub
const pubClient = createRedisClient('publisher');
const subClient = createRedisClient('subscriber');

// Middleware
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'collaboration-service' });
});

// Socket.IO server with Redis adapter
const io = new Server({
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// JWT authentication middleware for sockets
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication token required'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default-secret-key');
    socket.userId = decoded.userId;
    socket.userEmail = decoded.email;
    next();
  } catch (err) {
    next(new Error('Invalid token'));
  }
});

// Track active sessions
const activeSessions = new Map();

// Socket connection handling
io.on('connection', async (socket) => {
  console.log(`User ${socket.userId} connected with socket ${socket.id}`);

  // Handle joining a document
  socket.on('join-document', async (documentId) => {
    try {
      // Check if user has access to this document (this would typically call document service)
      // For now, we'll assume access is granted

      // Create or update collaboration session
      const session = await prisma.collaborationSession.upsert({
        where: {
          socketId: socket.id
        },
        update: {
          userId: socket.userId,
          status: 'active',
          lastSeen: new Date()
        },
        create: {
          documentId,
          userId: socket.userId,
          socketId: socket.id,
          joinedAt: new Date(),
          status: 'active'
        }
      });

      activeSessions.set(socket.id, session);

      // Join the document room
      socket.join(documentId);

      // Notify others in the document
      socket.to(documentId).emit('user-joined', {
        userId: socket.userId,
        sessionId: session.id
      });

      // Send current users in the document
      const documentSessions = await prisma.collaborationSession.findMany({
        where: {
          documentId,
          status: 'active'
        }
      });

      socket.emit('document-joined', {
        sessions: documentSessions
      });

    } catch (error) {
      console.error('Error joining document:', error);
      socket.emit('error', { message: 'Failed to join document' });
    }
  });

  // Handle cursor position updates
  socket.on('cursor-move', async (data) => {
    try {
      const { documentId, position, selection } = data;

      await prisma.cursorPosition.upsert({
        where: {
          documentId_userId: {
            documentId,
            userId: socket.userId
          }
        },
        update: {
          position,
          selection,
          updatedAt: new Date()
        },
        create: {
          documentId,
          userId: socket.userId,
          position,
          selection
        }
      });

      // Broadcast cursor position to others in the document
      socket.to(documentId).emit('cursor-update', {
        userId: socket.userId,
        position,
        selection
      });

    } catch (error) {
      console.error('Error updating cursor:', error);
    }
  });

  // Handle operational transforms
  socket.on('send-changes', async (data) => {
    try {
      const { documentId, operation, version } = data;

      // Store the operation
      const ot = await prisma.operationalTransform.create({
        data: {
          documentId,
          userId: socket.userId,
          operation,
          version
        }
      });

      // Broadcast the operation to others in the document
      socket.to(documentId).emit('receive-changes', {
        operation,
        version,
        userId: socket.userId,
        otId: ot.id
      });

    } catch (error) {
      console.error('Error processing changes:', error);
    }
  });

  // Handle disconnection
  socket.on('disconnect', async () => {
    try {
      const session = activeSessions.get(socket.id);
      if (session) {
        // Update session status
        await prisma.collaborationSession.update({
          where: { id: session.id },
          data: {
            status: 'disconnected',
            lastSeen: new Date()
          }
        });

        // Notify others in the document
        socket.to(session.documentId).emit('user-left', {
          userId: socket.userId,
          sessionId: session.id
        });

        activeSessions.delete(socket.id);
      }

      console.log(`User ${socket.userId} disconnected`);
    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  });
});

// Get active sessions for a document (REST endpoint)
app.get('/documents/:documentId/sessions', async (req, res) => {
  try {
    const { documentId } = req.params;

    const sessions = await prisma.collaborationSession.findMany({
      where: {
        documentId,
        status: 'active'
      },
      include: {
        cursorPosition: true
      }
    });

    res.json({ sessions });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get operational transforms for a document (for sync)
app.get('/documents/:documentId/transforms', async (req, res) => {
  try {
    const { documentId } = req.params;
    const { since } = req.query;

    const transforms = await prisma.operationalTransform.findMany({
      where: {
        documentId,
        ...(since && { id: { gt: parseInt(since) } })
      },
      orderBy: { id: 'asc' }
    });

    res.json({ transforms });
  } catch (error) {
    console.error('Error fetching transforms:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
const server = app.listen(PORT, async () => {
  try {
    await prisma.$connect();
    console.log(`Collaboration service running on port ${PORT}`);
    console.log('Connected to database successfully');
  } catch (error) {
    console.error('Failed to connect to database:', error);
    process.exit(1);
  }
});

// Attach Socket.IO to the server
io.attach(server);
