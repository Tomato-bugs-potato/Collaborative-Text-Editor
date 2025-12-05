const redis = require('redis');

// Create Redis client factory function
const createRedisClient = (clientName = 'default') => {
  let client;

  if (process.env.REDIS_NODES) {
    // Cluster mode
    const rootNodes = process.env.REDIS_NODES.split(',').map(node => {
      // Handle "host:port" format
      if (!node.startsWith('redis://')) {
        return { url: `redis://${node}` };
      }
      return { url: node };
    });

    console.log(`[Redis] Connecting to cluster with nodes:`, rootNodes);
    client = redis.createCluster({
      rootNodes,
      defaults: {
        socket: {
          connectTimeout: 5000
        }
      }
    });
  } else {
    // Standalone mode
    client = redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });
  }

  client.on('error', (err) => console.error(`Redis Error (${clientName}):`, err));
  client.on('connect', () => console.log(`Redis connected (${clientName})`));
  client.on('ready', () => console.log(`Redis client ready (${clientName})`));
  client.on('end', () => console.log(`Redis connection ended (${clientName})`));

  return client;
};

// Create and export default Redis clients for pub/sub patterns
const createPubSubClients = () => {
  const pubClient = createRedisClient('publisher');
  const subClient = createRedisClient('subscriber');

  return { pubClient, subClient };
};

module.exports = {
  createRedisClient,
  createPubSubClients
};
