const { Kafka } = require('kafkajs');

const kafka = new Kafka({
  clientId: 'document-service',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
});

const producer = kafka.producer();

const connectProducer = async () => {
  await producer.connect();
  return producer;
};

const publishDocumentEvent = async (type, payload) => {
  if (!producer || !producer.send) {
    throw new Error('Kafka producer not connected');
  }

  await producer.send({
    topic: 'document-events',
    messages: [
      {
        key: payload.documentId || 'unknown',
        value: JSON.stringify({ type, ...payload }),
      },
    ],
  });
};

module.exports = {
  connectProducer,
  publishDocumentEvent,
};
