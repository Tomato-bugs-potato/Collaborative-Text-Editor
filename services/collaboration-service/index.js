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
const Redis = require('ioredis');
const { createAdapter } = require("@socket.io/redis-adapter");
const { connect: dbConnect, prisma, prismaRead } = require('./db');

// Configuration
const PORT = process.env.PORT || 3003;
const INSTANCE_ID = process.env.INSTANCE_ID || 'collab-1';
const PRESENCE_SERVICE_URL = process.env.PRESENCE_SERVICE_URL || 'http://presence-service:3005';
const REDIS_NODES = (process.env.REDIS_NODES || 'redis-node-1:7001,redis-node-2:7002,redis-node-3:7003').split(',');

// Express app
const app = express();
app.use(express.json());

console.log(`[${INSTANCE_ID}] Starting Collaboration Service`);
console.log(`[${INSTANCE_ID}] Redis nodes: ${REDIS_NODES.join(', ')}`);

// Create Redis Cluster clients for pub/sub using ioredis
function createRedisClusterClient(name) {
  const clusterNodes = REDIS_NODES.map(node => {
    const [host, port] = node.split(':');
    return { host, port: parseInt(port) || 6379 };
  });

  const client = new Redis.Cluster(clusterNodes, {
    redisOptions: {
      password: undefined, // Set if Redis requires auth
    },
    scaleReads: 'slave',
    enableReadyCheck: true,
    maxRedirections: 16,
    retryDelayOnFailover: 100,
    retryDelayOnClusterDown: 100,
    clusterRetryStrategy: (times) => Math.min(times * 100, 3000)
  });

  client.on('error', (err) => console.error(`[${INSTANCE_ID}] Redis Cluster ${name} error:`, err.message));
  client.on('ready', () => console.log(`[${INSTANCE_ID}] Redis Cluster ${name} ready`));
  client.on('connect', () => console.log(`[${INSTANCE_ID}] Redis Cluster ${name} connected`));
  client.on('+node', (node) => console.log(`[${INSTANCE_ID}] Redis node added:`, node.options?.host));
  client.on('-node', (node) => console.log(`[${INSTANCE_ID}] Redis node removed:`, node.options?.host));

  return client;
}

const pubClient = createRedisClusterClient('publisher');
const subClient = createRedisClusterClient('subscriber');

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

// Track Redis connection status
let isRedisReady = false;

// Health endpoints
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'collaboration-service', instance: INSTANCE_ID });
});

app.get('/ready', (req, res) => {
  if (isRedisReady) {
    res.json({ ready: true, redis: 'connected' });
  } else {
    res.status(503).json({ ready: false, redis: 'disconnected' });
  }
});

// Socket.IO setup
const io = new Server({
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Connect Redis adapter with retry logic
async function connectRedisAdapter() {
  const maxRetries = 10;
  let retries = 0;

  // Helper to wait for ioredis cluster to be ready
  const waitForReady = (client, name) => {
    return new Promise((resolve, reject) => {
      if (client.status === 'ready') {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error(`${name} connection timeout`));
      }, 5000);

      client.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });

      client.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  };

  while (retries < maxRetries && !isRedisReady) {
    try {
      console.log(`[${INSTANCE_ID}] Attempting to connect Redis Cluster adapter (attempt ${retries + 1}/${maxRetries})...`);

      // Wait for both clients to be ready (ioredis auto-connects)
      await Promise.all([
        waitForReady(pubClient, 'pubClient'),
        waitForReady(subClient, 'subClient')
      ]);

      io.adapter(createAdapter(pubClient, subClient));
      isRedisReady = true;
      console.log(`[${INSTANCE_ID}] ✓ Redis Cluster adapter connected successfully!`);
      return true;
    } catch (err) {
      retries++;
      console.error(`[${INSTANCE_ID}] Redis Cluster adapter connection failed (attempt ${retries}/${maxRetries}):`, err.message);
      if (retries < maxRetries) {
        console.log(`[${INSTANCE_ID}] Retrying in 3 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }

  if (!isRedisReady) {
    console.error(`[${INSTANCE_ID}] ✗ Failed to connect Redis adapter after ${maxRetries} attempts. Real-time sync will NOT work across instances!`);
  }
  return isRedisReady;
}

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

      // Store documentId for disconnect handling
      socket.documentId = documentId;

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
    if (socket.documentId) {
      socket.to(socket.documentId).emit('user-left', { userId: socket.userId });
    }
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

    const transforms = await prismaRead.operationalTransform.findMany({
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

// Start server after Redis is connected
async function startServer() {
  // First connect Redis adapter
  await connectRedisAdapter();

  // Then start the HTTP server
  const server = app.listen(PORT, () => {
    console.log(`[${INSTANCE_ID}] Collaboration service running on port ${PORT}`);
    console.log(`[${INSTANCE_ID}] Redis adapter status: ${isRedisReady ? 'CONNECTED' : 'DISCONNECTED'}`);
  });

  // Attach Socket.IO to the server
  io.attach(server);

  return server;
}

// Initialize
let server;
startServer().then(s => {
  server = s;
}).catch(err => {
  console.error(`[${INSTANCE_ID}] Failed to start service:`, err);
  process.exit(1);
});

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
