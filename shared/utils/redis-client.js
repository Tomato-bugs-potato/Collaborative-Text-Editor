// Redis client factory - services should pass their own redis instance
const createRedisClient = (redis, clientName = 'default') => {
  const client = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  });

  client.on('error', (err) => console.error(`Redis Error (${clientName}):`, err));
  client.on('connect', () => console.log(`Redis connected (${clientName})`));

  return client;
};

module.exports = { createRedisClient };
