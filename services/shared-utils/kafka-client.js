const { Kafka } = require('kafkajs');

/**
 * Create a Kafka client instance
 * @param {string} clientId - The client ID for this service
 * @param {string[]} brokers - List of Kafka brokers
 */
const createKafkaClient = (clientId, brokers) => {
    const kafka = new Kafka({
        clientId,
        brokers: brokers || (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
        retry: {
            initialRetryTime: 100,
            retries: 8
        }
    });

    return kafka;
};

module.exports = {
    createKafkaClient
};
