const { Kafka } = require('kafkajs');

const instanceId = process.env.INSTANCE_ID || 'reconcile-1';
const consumerGroup = process.env.CONSUMER_GROUP || 'reconciliation-group';
const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');

console.log(`[${instanceId}] Starting Reconciliation Service`);
console.log(`[${instanceId}] Kafka Brokers:`, kafkaBrokers);

const kafka = new Kafka({
  clientId: instanceId,
  brokers: kafkaBrokers,
  retry: {
    initialRetryTime: 100,
    retries: 8
  }
});

const consumer = kafka.consumer({ 
  groupId: consumerGroup,
  sessionTimeout: 30000,
  heartbeatInterval: 3000
});

async function reconcileDocument(message) {
  const { documentId, operation, timestamp, userId } = JSON.parse(message.value.toString());

  console.log(`[${instanceId}] Reconciling document ${documentId}, operation: ${operation}`);

  try {
    // Placeholder for actual reconciliation logic
    // For now, just log the operation without database storage
    console.log(`[${instanceId}] Would store: document=${documentId}, operation=${operation}, user=${userId}, timestamp=${timestamp}`);

    console.log(`[${instanceId}] Successfully reconciled document ${documentId}`);
  } catch (error) {
    console.error(`[${instanceId}] Error reconciling document ${documentId}:`, error);
    throw error;
  }
}

async function run() {
  try {
    await consumer.connect();
    console.log(`[${instanceId}] Connected to Kafka`);
    
    await consumer.subscribe({ 
      topics: ['document-changes', 'collaboration-events'],
      fromBeginning: false 
    });
    
    console.log(`[${instanceId}] Subscribed to topics`);
    
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        console.log(`[${instanceId}] Received message from topic ${topic}, partition ${partition}`);
        
        try {
          await reconcileDocument(message);
        } catch (error) {
          console.error(`[${instanceId}] Failed to process message:`, error);
          // In production, you might want to send to a dead letter queue
        }
      },
    });
    
    console.log(`[${instanceId}] Consumer running`);
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
      process.exit(0);
    } catch (_) {
      process.exit(1);
    }
  });
});

signalTraps.forEach(type => {
  process.once(type, async () => {
    try {
      console.log(`[${instanceId}] Received ${type}, shutting down gracefully`);
      await consumer.disconnect();
    } finally {
      process.kill(process.pid, type);
    }
  });
});

run();