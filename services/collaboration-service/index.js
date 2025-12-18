/**
 * Collaboration Service
 * 
 * Real-time collaboration service handling WebSocket connections
 * and operational transformation for document editing.
 * Implements batch writing for OperationalTransforms to optimize DB performance.
 */

require("dotenv").config();

const express = require('express');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { Kafka } = require('kafkajs');
const { createCluster } = require('redis');
const { createAdapter } = require("@socket.io/redis-adapter");
const { connect: dbConnect, prisma } = require('./db');

// Configuration
const PORT = process.env.PORT || 3003;
const INSTANCE_ID = process.env.INSTANCE_ID || 'collab-1';
const PRESENCE_SERVICE_URL = process.env.PRESENCE_SERVICE_URL || 'http://presence-service:3005';
const REDIS_NODES = (process.env.REDIS_NODES || 'redis-node-1:7001,redis-node-2:7002,redis-node-3:7003').split(',');

// Express app
const app = express();
app.use(express.json());

console.log(`[${INSTANCE_ID}] Starting Collaboration Service`);

// Create Redis Cluster clients for pub/sub
function createRedisCluster(name) {
  const rootNodes = REDIS_NODES.map(node => {
    const [host, port] = node.split(':');
    return { socket: { host, port: parseInt(port) || 6379 } };
  });

  const client = createCluster({
    rootNodes: rootNodes,
    useReplicas: true
  });

  client.on('error', (err) => console.error(`[${INSTANCE_ID}] Redis Cluster ${name} error:`, err));
  client.on('ready', () => console.log(`[${INSTANCE_ID}] Redis Cluster ${name} connected`));

  return client;
}

const pubClient = createRedisCluster('publisher');
const subClient = createRedisCluster('subscriber');

// Kafka Configuration
const kafka = new Kafka({
  clientId: INSTANCE_ID,
  brokers: (process.env.KAFKA_BROKERS || 'kafka-1:9092,kafka-2:9093,kafka-3:9094').split(','),
  retry: {
    initialRetryTime: 100,
    retries: 8
  }
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: `collaboration-group-${INSTANCE_ID}` });
let isProducerConnected = false;

const connectKafka = async () => {
  try {
    await producer.connect();
    isProducerConnected = true;
    console.log(`[${INSTANCE_ID}] Kafka producer connected`);

    await consumer.connect();
    await consumer.subscribe({ topics: ['document-updates', 'document-events'], fromBeginning: false });
    console.log(`[${INSTANCE_ID}] Kafka consumer connected and subscribed`);

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const data = JSON.parse(message.value.toString());
          console.log(`[${INSTANCE_ID}] Received Kafka message on ${topic}:`, data);

          if (topic === 'document-updates') {
            const { documentId, version, status, userId } = data;
            // Broadcast sync status to all clients in the document room
            io.to(documentId).emit('document-synced', {
              version,
              status,
              userId,
              timestamp: new Date().toISOString()
            });
          } else if (topic === 'document-events') {
            if (data.type === 'DOCUMENT_UPDATED') {
              // Notify clients that the document was updated externally (e.g., via REST)
              io.to(data.documentId).emit('document-external-update', {
                documentId: data.documentId,
                userId: data.userId,
                timestamp: new Date().toISOString()
              });
            }
          }
        } catch (err) {
          console.error(`[${INSTANCE_ID}] Error processing Kafka message:`, err);
        }
      }
    });
  } catch (error) {
    console.error(`[${INSTANCE_ID}] Failed to connect Kafka:`, error);
  }
};

connectKafka();

// Batching for OperationalTransforms
let otBuffer = [];
const BATCH_SIZE = 50;
const FLUSH_INTERVAL = 2000; // 2 seconds

async function flushOTs() {
  if (otBuffer.length === 0) return;

  const batch = [...otBuffer];
  otBuffer = [];

  try {
    console.log(`[${INSTANCE_ID}] Flushing ${batch.length} OTs to database`);
    await prisma.operationalTransform.createMany({
      data: batch,
      skipDuplicates: true
    });
  } catch (error) {
    console.error(`[${INSTANCE_ID}] Error flushing OTs:`, error);
    // Put back in buffer if failed (optional, depends on retry strategy)
    otBuffer = [...batch, ...otBuffer];
  }
}

setInterval(flushOTs, FLUSH_INTERVAL);

// Health endpoints
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'collaboration-service', instance: INSTANCE_ID });
});

app.get('/ready', (req, res) => {
  res.json({ ready: true });
});

// Socket.IO setup
const io = new Server({
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Connect Redis adapter
Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
  io.adapter(createAdapter(pubClient, subClient));
  console.log(`[${INSTANCE_ID}] Redis Cluster adapter connected`);
}).catch(err => {
  console.error(`[${INSTANCE_ID}] Redis Cluster adapter connection error:`, err);
});

// JWT authentication middleware for Socket.IO
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

// Socket.IO connection handler
io.on('connection', async (socket) => {
  console.log(`[${INSTANCE_ID}] User ${socket.userId} connected with socket ID ${socket.id}`);

  socket.on('join-document', async (documentId) => {
    try {
      console.log(`[${INSTANCE_ID}] User ${socket.userId} joining document: ${documentId}`);
      // Join the document room
      socket.join(documentId);

      // Register presence via Presence Service
      await fetch(`${PRESENCE_SERVICE_URL}/presence/${documentId}/${socket.userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: socket.userEmail,
          cursor: 0,
          selection: null
        })
      });

      // Notify others in the document
      socket.to(documentId).emit('user-joined', {
        userId: socket.userId
      });

      // Get current users from Presence Service
      const response = await fetch(`${PRESENCE_SERVICE_URL}/presence/${documentId}`);
      const data = await response.json();

      socket.emit('document-joined', {
        sessions: data.users || []
      });

    } catch (error) {
      console.error(`[${INSTANCE_ID}] Error joining document:`, error);
      socket.emit('error', { message: 'Failed to join document' });
    }
  });

  socket.on('cursor-move', async (data) => {
    try {
      const { documentId, position, selection } = data;

      // Update presence (don't await to avoid blocking)
      fetch(`${PRESENCE_SERVICE_URL}/presence/${documentId}/${socket.userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cursor: position,
          selection
        })
      }).catch(err => console.error(`[${INSTANCE_ID}] Failed to update presence:`, err));

      // Broadcast cursor position to others in the document
      socket.to(documentId).emit('cursor-update', {
        userId: socket.userId,
        position,
        selection
      });

    } catch (error) {
      console.error(`[${INSTANCE_ID}] Error updating cursor:`, error);
    }
  });

  socket.on('send-changes', async (data) => {
    try {
      const { documentId, operation, version } = data;
      console.log(`[${INSTANCE_ID}] Received changes from user ${socket.userId} for doc ${documentId}, version ${version}`);

      // Buffer the operation for batch writing
      otBuffer.push({
        documentId,
        userId: parseInt(socket.userId),
        operation,
        version: parseInt(version),
        timestamp: new Date()
      });

      // Broadcast the operation to others in the document immediately
      socket.to(documentId).emit('receive-changes', {
        operation,
        version,
        userId: socket.userId
      });

      // Publish to Kafka for reconciliation
      if (isProducerConnected) {
        try {
          await producer.send({
            topic: 'document-changes',
            messages: [
              {
                key: documentId,
                value: JSON.stringify({
                  documentId,
                  operation,
                  version,
                  userId: socket.userId,
                  timestamp: new Date().toISOString()
                })
              }
            ]
          });
        } catch (err) {
          console.error(`[${INSTANCE_ID}] Failed to publish to Kafka:`, err);
        }
      }

      // Flush if buffer gets too large
      if (otBuffer.length >= BATCH_SIZE) {
        flushOTs();
      }

    } catch (error) {
      console.error(`[${INSTANCE_ID}] Error processing changes:`, error);
    }
  });

  socket.on('disconnect', async () => {
    console.log(`[${INSTANCE_ID}] User ${socket.userId} disconnected`);
  });
});

// REST API endpoints
app.get('/documents/:documentId/sessions', async (req, res) => {
  try {
    const { documentId } = req.params;
    const response = await fetch(`${PRESENCE_SERVICE_URL}/presence/${documentId}`);
    const data = await response.json();
    res.json({ sessions: data.users });
  } catch (error) {
    console.error(`[${INSTANCE_ID}] Error fetching sessions:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
    console.error(`[${INSTANCE_ID}] Error fetching transforms:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
const server = app.listen(PORT, async () => {
  try {
    await dbConnect();
    console.log(`[${INSTANCE_ID}] Collaboration service running on port ${PORT}`);
    console.log(`[${INSTANCE_ID}] Connected to database successfully`);
  } catch (error) {
    console.error(`[${INSTANCE_ID}] Failed to connect to database:`, error);
    process.exit(1);
  }
});

io.attach(server);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log(`[${INSTANCE_ID}] Received SIGTERM, flushing and shutting down`);
  await flushOTs();
  await producer.disconnect();
  await consumer.disconnect();
  await pubClient.quit();
  await subClient.quit();
  await prisma.$disconnect();
  process.exit(0);
});
