const Redis = require('ioredis');

/**
 * Create a Redis Cluster client using ioredis
 * @param {string} serviceName - Name of the service using the client (for logging)
 * @returns {object} - Redis Cluster client
 */
const createRedisClient = (serviceName) => {
    const redisNodes = process.env.REDIS_NODES || 'redis-cluster-0.redis-cluster:6379';
    const clusterNodes = redisNodes.split(',').map(node => {
        const [host, port] = node.split(':');
        return { host, port: parseInt(port) || 6379 };
    });

    console.log(`[${serviceName}] Connecting to Redis Cluster:`, clusterNodes.map(n => `${n.host}:${n.port}`).join(', '));

    const client = new Redis.Cluster(clusterNodes, {
        redisOptions: {
            password: undefined, // Set if Redis requires auth
            maxRetriesPerRequest: 20,
            enableOfflineQueue: true,
        },
        scaleReads: 'slave',
        enableReadyCheck: true,
        maxRedirections: 16,
        retryDelayOnFailover: 100,
        retryDelayOnClusterDown: 100,
        clusterRetryStrategy: (times) => {
            if (times > 20) {
                console.error(`[${serviceName}] Redis connection retries exhausted`);
                return null; // Stop retrying
            }
            return Math.min(times * 100, 3000);
        }
    });

    client.on('error', (err) => console.error(`[${serviceName}] Redis Client Error:`, err.message));
    client.on('connect', () => console.log(`[${serviceName}] Redis Client Connecting...`));
    client.on('ready', () => console.log(`[${serviceName}] ✓ Redis Client Ready`));

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
