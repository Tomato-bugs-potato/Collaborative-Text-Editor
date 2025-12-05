const { createKafkaClient } = require('../../shared-utils');

const instanceId = process.env.INSTANCE_ID || 'document-service';
const kafka = createKafkaClient(instanceId);
const producer = kafka.producer();

let isConnected = false;

const connectProducer = async () => {
    let retries = 0;
    while (!isConnected && retries < 10) {
        try {
            await producer.connect();
            isConnected = true;
            console.log(`[${instanceId}] Kafka producer connected`);
        } catch (error) {
            console.error(`[${instanceId}] Failed to connect Kafka producer (attempt ${retries + 1}):`, error.message);
            retries++;
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
};

const publishDocumentEvent = async (type, payload) => {
    if (!isConnected) {
        console.warn(`[${instanceId}] Kafka producer not connected, skipping event: ${type}`);
        return;
    }

    try {
        await producer.send({
            topic: 'document-changes',
            messages: [
                {
                    key: payload.documentId || 'unknown',
                    value: JSON.stringify({
                        type,
                        timestamp: new Date().toISOString(),
                        source: instanceId,
                        ...payload
                    })
                }
            ]
        });
        console.log(`[${instanceId}] Published event: ${type} for doc ${payload.documentId}`);
    } catch (error) {
        console.error(`[${instanceId}] Failed to publish event:`, error);
    }
};

module.exports = {
    connectProducer,
    publishDocumentEvent
};
