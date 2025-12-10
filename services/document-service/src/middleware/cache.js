const { createRedisClient } = require('../../shared-utils');

const redisClient = createRedisClient('document-cache');

// Connect to Redis
(async () => {
    try {
        await redisClient.connect();
        console.log('[Cache] Redis client connected');
    } catch (error) {
        console.error('[Cache] Redis connection error:', error);
    }
})();

const CACHE_TTL = 60; // 60 seconds

// Cache middleware
const cache = async (req, res, next) => {
    if (!redisClient.isOpen) {
        return next();
    }

    const { id } = req.params;
    const key = `doc:${id}`;

    try {
        const cachedData = await redisClient.get(key);

        if (cachedData) {
            console.log(`[Cache] Hit for ${key}`);
            return res.json(JSON.parse(cachedData));
        }

        console.log(`[Cache] Miss for ${key}`);

        // Intercept response to cache it
        const originalJson = res.json;
        res.json = function (data) {
            if (res.statusCode === 200 && data.success) {
                redisClient.setEx(key, CACHE_TTL, JSON.stringify(data))
                    .catch(err => console.error('[Cache] Set error:', err));
            }
            return originalJson.call(this, data);
        };

        next();
    } catch (error) {
        console.error('[Cache] Error:', error);
        next();
    }
};

// Invalidate cache
const invalidateCache = async (id) => {
    if (!redisClient.isOpen) return;

    try {
        await redisClient.del(`doc:${id}`);
        console.log(`[Cache] Invalidated doc:${id}`);
    } catch (error) {
        console.error('[Cache] Invalidation error:', error);
    }
};

module.exports = {
    cache,
    invalidateCache
};
