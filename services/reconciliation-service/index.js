/**
 * Reconciliation Service
 * 
 * Handles Operational Transformation (OT) for document changes
 * and ensures consistency across distributed instances.
 * Implements batch writing to PostgreSQL for improved performance.
 */

require('dotenv').config();
const express = require('express');
const { Kafka } = require('kafkajs');
const ot = require('ot-text');
const { prisma, prismaRead } = require('./shared-utils/prisma-client');
const { prisma, prismaRead } = require('./shared-utils/prisma-client');
const { setupMetrics, kafkaMessagesTotal } = require('./shared-utils');
const Redis = require('ioredis');

// Redis Configuration for Cache Invalidation
const REDIS_NODES = (process.env.REDIS_NODES || 'redis-node-1:7001,redis-node-2:7002,redis-node-3:7003').split(',');
const redisClient = new Redis.Cluster(REDIS_NODES.map(node => {
  const [host, port] = node.split(':');
  return { host, port: parseInt(port) || 6379 };
}), {
  redisOptions: { password: process.env.REDIS_PASSWORD },
  scaleReads: 'slave'
});

redisClient.on('error', (err) => console.error(`[${instanceId}] Redis Cluster Error:`, err.message));
redisClient.on('ready', () => console.log(`[${instanceId}] Redis Cluster Ready for Cache Invalidation`));

const app = express();
const instanceId = process.env.INSTANCE_ID || `reconcile-${Math.floor(Math.random() * 1000)}`;
const PORT = process.env.PORT || 3004;

// Kafka Configuration
const kafkaBrokers = (process.env.KAFKA_BROKERS || 'kafka-1:9092,kafka-2:9093,kafka-3:9094').split(',');
const kafka = new Kafka({
  clientId: `reconciliation-service-${instanceId}`,
  brokers: kafkaBrokers,
  retry: {
    initialRetryTime: 100,
    retries: 8
  }
});

const consumer = kafka.consumer({ groupId: 'reconciliation-group' });
const producer = kafka.producer();

const DLQ_TOPIC = process.env.DLQ_TOPIC || 'reconciliation-dlq';

// Metrics
setupMetrics(app, 'reconciliation-service', instanceId);

// In-memory buffer for document operations (for performance)
const operationBuffers = new Map();

/**
 * Get or create a document buffer
 */
function getDocumentBuffer(documentId, initialContent = '', initialVersion = 0) {
  if (!operationBuffers.has(documentId)) {
    operationBuffers.set(documentId, {
      operations: [],
      serverVersion: initialVersion,
      currentContent: initialContent,
      lastModified: Date.now(),
      isDirty: false
    });
  }
  return operationBuffers.get(documentId);
}

/**
 * Flush dirty buffers to PostgreSQL and publish snapshots to Kafka
 */
async function flushBuffers() {
  const now = Date.now();
  for (const [documentId, buffer] of operationBuffers.entries()) {
    if (buffer.isDirty) {
      try {
        console.log(`[${instanceId}] Flushing document ${documentId} to database (version ${buffer.serverVersion})`);

        // 1. Update PostgreSQL
        await prisma.document.update({
          value: JSON.stringify({
            documentId,
            data: buffer.currentContent,
            version: buffer.serverVersion,
            timestamp: new Date().toISOString()
          })
        }]
        });
      console.log(`[${instanceId}] Snapshot published to Kafka topic 'document-snapshots' for doc ${documentId}`);

      buffer.isDirty = false;
      buffer.lastModified = now;
    } catch (error) {
      console.error(`[${instanceId}] Error flushing document ${documentId}:`, error);
    }
  }
}
}

// Flush every 2 seconds
setInterval(flushBuffers, 2000);

/**
 * Clean up old document buffers (called periodically)
 */
function cleanupOldBuffers() {
  const maxAge = 30 * 60 * 1000; // 30 minutes
  const now = Date.now();

  for (const [docId, buffer] of operationBuffers.entries()) {
    if (!buffer.isDirty && (now - buffer.lastModified > maxAge)) {
      operationBuffers.delete(docId);
      console.log(`[${instanceId}] Cleaned up buffer for document ${docId}`);
    }
  }
}

// Cleanup every 5 minutes
setInterval(cleanupOldBuffers, 5 * 60 * 1000);

/**
 * Send message to Dead Letter Queue
 */
async function sendToDLQ(originalMessage, error, topic) {
  try {
    await producer.send({
      topic: DLQ_TOPIC,
      messages: [{
        key: originalMessage.key?.toString() || 'unknown',
        value: JSON.stringify({
          originalTopic: topic,
          originalMessage: originalMessage.value?.toString(),
          error: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString(),
          instance: instanceId
        }),
        headers: {
          'x-original-topic': topic,
          'x-error': error.message,
          'x-retry-count': '0'
        }
      }]
    });

    kafkaMessagesTotal.labels(DLQ_TOPIC, 'sent').inc();
    console.log(`[${instanceId}] Sent failed message to DLQ: ${error.message}`);
  } catch (dlqError) {
    console.error(`[${instanceId}] Failed to send to DLQ:`, dlqError);
  }
}

/**
 * Reconcile a document operation using OT
 */
async function reconcileDocument(message, topic) {
  let messageData;

  try {
    messageData = JSON.parse(message.value.toString());
  } catch (parseError) {
    console.error(`[${instanceId}] Failed to parse message:`, parseError);
    await sendToDLQ(message, parseError, topic);
    return;
  }

  const { documentId, operation, version, userId, timestamp } = messageData;

  console.log(`[${instanceId}] Processing operation for doc ${documentId}, client version: ${version}, user: ${userId}`);
  kafkaMessagesTotal.labels('document-changes', 'received').inc();

  if (!operation || !documentId) {
    console.warn(`[${instanceId}] Skipping message with missing operation or documentId`);
    return;
  }

  try {
    // 1. Get document buffer
    let buffer = operationBuffers.get(documentId);

    // If not in buffer, fetch from DB
    if (!buffer) {
      const document = await prisma.document.findUnique({
        where: { id: documentId }
      });

      if (!document) {
        console.error(`[${instanceId}] Document ${documentId} not found`);
        return;
      }

      buffer = getDocumentBuffer(documentId, document.data || '', document.version || 0);
    }

    // 2. Transform operation against concurrent operations
    let transformedOp = operation;
    const clientVersion = version || 0;

    // Get operations that happened after the client's version
    const concurrentOps = buffer.operations.filter(op => op.version > clientVersion);

    // Transform against each concurrent operation
    for (const concurrentOp of concurrentOps) {
      try {
        transformedOp = ot.transformOperation(transformedOp, concurrentOp.operation, 'left');
      } catch (transformError) {
        console.error(`[${instanceId}] Transform error:`, transformError);
      }
    }

    // 3. Apply operation to current content in memory
    try {
      if (Array.isArray(transformedOp)) {
        buffer.currentContent = ot.applyOperation(buffer.currentContent, transformedOp);
      } else {
        console.log(`[${instanceId}] Received non-array operation format for doc ${documentId}`);
      }
    } catch (applyError) {
      console.error(`[${instanceId}] Error applying operation:`, applyError);
    }

    // 4. Update buffer state
    const newVersion = buffer.serverVersion + 1;
    buffer.serverVersion = newVersion;
    buffer.isDirty = true;
    buffer.lastModified = Date.now();

    buffer.operations.push({
      operation: transformedOp,
      version: newVersion,
      userId,
      timestamp: timestamp || new Date().toISOString()
    });

    // Keep only last 100 operations per document
    if (buffer.operations.length > 100) {
      buffer.operations = buffer.operations.slice(-100);
    }

    console.log(`[${instanceId}] Reconciled doc ${documentId} to version ${newVersion} (In-memory)`);

    // 5. Broadcast acknowledgment via Kafka
    await producer.send({
      topic: 'document-updates',
      messages: [{
        key: documentId,
        value: JSON.stringify({
          documentId,
          version: newVersion,
          status: 'synced',
          userId,
          serverVersion: newVersion,
          timestamp: new Date().toISOString()
        })
      }]
    });

    kafkaMessagesTotal.labels('document-updates', 'sent').inc();

  } catch (error) {
    console.error(`[${instanceId}] Error reconciling document ${documentId}:`, error);
    await sendToDLQ(message, error, topic);
  }
}

/**
 * Handle document lifecycle events
 */
async function handleDocumentEvent(message, topic) {
  try {
    const event = JSON.parse(message.value.toString());
    console.log(`[${instanceId}] Received document event: ${event.type} for doc ${event.documentId}`);
    kafkaMessagesTotal.labels('document-events', 'received').inc();

    // Handle specific event types
    switch (event.type) {
      case 'document-created':
        // Initialize buffer for new document
        getDocumentBuffer(event.documentId);
        break;

      case 'document-deleted':
        // Clean up buffer
        operationBuffers.delete(event.documentId);
        break;

      case 'DOCUMENT_UPDATED':
        // Document was updated externally (e.g., via REST API)
        console.log(`[${instanceId}] Document ${event.documentId} updated externally, invalidating buffer`);
        // We delete the buffer so it's re-fetched from DB on next operation
        operationBuffers.delete(event.documentId);
        break;

      default:
        console.log(`[${instanceId}] Unhandled event type: ${event.type}`);
    }
  } catch (error) {
    console.error(`[${instanceId}] Error handling document event:`, error);
    await sendToDLQ(message, error, topic);
  }
}

/**
 * Main consumer loop
 */
async function run() {
  try {
    // Shared prisma client handles connection and discovery
    console.log(`[${instanceId}] Initializing Database connection via shared client`);

    await consumer.connect();
    await producer.connect();
    console.log(`[${instanceId}] Connected to Kafka`);

    // Create topics if they don't exist
    const admin = kafka.admin();
    await admin.connect();
    try {
      await admin.createTopics({
        topics: [
          { topic: DLQ_TOPIC, numPartitions: 3, replicationFactor: 1 },
          { topic: 'document-snapshots', numPartitions: 3, replicationFactor: 1 }
        ]
      });
      console.log(`[${instanceId}] Kafka topics created or already exist`);
    } catch (topicError) {
      console.log(`[${instanceId}] Kafka topics check: ${topicError.message}`);
    }
    await admin.disconnect();

    await consumer.subscribe({
      topics: ['document-changes', 'document-events'],
      fromBeginning: false
    });

    console.log(`[${instanceId}] Subscribed to topics`);

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          console.log(`[${instanceId}] Received message on ${topic}:${partition}`);

          if (topic === 'document-changes') {
            await reconcileDocument(message, topic);
          } else if (topic === 'document-events') {
            await handleDocumentEvent(message, topic);
          }
        } catch (error) {
          console.error(`[${instanceId}] Failed to process message:`, error);
          await sendToDLQ(message, error, topic);
        }
      }
    });

    console.log(`[${instanceId}] Consumer running - OT reconciliation active`);
  } catch (error) {
    console.error(`[${instanceId}] Error starting consumer:`, error);
    process.exit(1);
  }
}

// Graceful shutdown
const errorTypes = ['unhandledRejection', 'uncaughtException'];
const signalTraps = ['SIGTERM', 'SIGINT', 'SIGUSR2'];

errorTypes.forEach(type => {
  process.on(type, async (error) => {
    try {
      console.log(`[${instanceId}] ${type}:`, error);
      await consumer.disconnect();
      await producer.disconnect();
      // Shared prisma client handles its own disconnect if needed
      process.exit(0);
    } catch (_) {
      process.exit(1);
    }
  });
});

signalTraps.forEach(type => {
  process.once(type, async () => {
    try {
      console.log(`[${instanceId}] Received ${type}, flushing and shutting down`);
      await flushBuffers();
      await consumer.disconnect();
      await producer.disconnect();
    } finally {
      process.kill(process.pid, type);
    }
  });
});

run();
app.listen(PORT, () => console.log(`[${instanceId}] Metrics server running on port ${PORT}`));