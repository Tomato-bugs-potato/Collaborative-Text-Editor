const { createCluster } = require('redis');

/**
 * Create a Redis Cluster client
 * @param {string} serviceName - Name of the service using the client (for logging)
 * @returns {object} - Redis Cluster client
 */
const createRedisClient = (serviceName) => {
    const redisNodes = process.env.REDIS_NODES || 'localhost:7001,localhost:7002,localhost:7003';
    const rootNodes = redisNodes.split(',').map(node => {
        const [host, port] = node.split(':');
        return {
            url: `redis://${host}:${port}`
        };
    });

    console.log(`[${serviceName}] Connecting to Redis Cluster nodes:`, rootNodes);

    const client = createCluster({
        rootNodes: rootNodes,
        defaults: {
            socket: {
                connectTimeout: 10000,
                reconnectStrategy: (retries) => {
                    if (retries > 20) {
                        console.error(`[${serviceName}] Redis connection retries exhausted`);
                        return new Error('Redis connection retries exhausted');
                    }
                    return Math.min(retries * 100, 3000);
                }
            }
        }
    });

    client.on('error', (err) => console.error(`[${serviceName}] Redis Client Error`, err));
    client.on('connect', () => console.log(`[${serviceName}] Redis Client Connected`));
    client.on('ready', () => console.log(`[${serviceName}] Redis Client Ready`));

    // Auto-connect
    client.connect().catch(err => {
        console.error(`[${serviceName}] Failed to connect to Redis`, err);
    });

    return client;
};

/**
 * Create Pub/Sub clients (separate clients for publisher and subscriber)
 * @param {string} serviceName 
 * @returns {object} { pubClient, subClient }
 */
const createPubSubClients = (serviceName) => {
    const pubClient = createRedisClient(`${serviceName}-pub`);
    const subClient = createRedisClient(`${serviceName}-sub`);
    return { pubClient, subClient };
};

module.exports = {
    createRedisClient,
    createPubSubClients
};
