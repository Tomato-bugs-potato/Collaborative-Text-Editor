require("dotenv").config();
const express = require('express');
const cors = require('cors');
const { createCluster } = require('redis');
const { setupMetrics } = require('./shared-utils');

const app = express();
const PORT = process.env.PORT || 3005;
const INSTANCE_ID = process.env.INSTANCE_ID || 'presence-1';

// Setup Prometheus metrics
setupMetrics(app, 'presence-service', INSTANCE_ID);

// Redis Client
const redisClient = createCluster({
    rootNodes: [
        { url: process.env.REDIS_URL || 'redis://redis-node-1:7001' }
    ]
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));
redisClient.on('connect', () => console.log(`[${INSTANCE_ID}] Connected to Redis`));

app.use(cors());
app.use(express.json());

// Swagger UI
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./src/config/swagger');
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'presence-service', instance: INSTANCE_ID });
});

// Update presence (heartbeat + cursor)
app.post('/presence/:documentId/:userId', async (req, res) => {
    try {
        const { documentId, userId } = req.params;
        const { cursor, selection, name, color } = req.body;

        const key = `presence:${documentId}:${userId}`;
        const data = JSON.stringify({
            userId,
            name,
            color,
            cursor,
            selection,
            lastSeen: Date.now()
        });

        // Store in Redis with TTL (e.g., 30 seconds)
        await redisClient.set(key, data, {
            EX: 30
        });

        // Add to sorted set for the document
        const setKey = `doc_users:${documentId}`;
        await redisClient.zAdd(setKey, { score: Date.now(), value: userId });

        // Set expiry on the set itself too
        await redisClient.expire(setKey, 300);

        res.json({ status: 'ok' });
    } catch (error) {
        console.error('Error updating presence:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get active users for a document
app.get('/presence/:documentId', async (req, res) => {
    try {
        const { documentId } = req.params;
        const setKey = `doc_users:${documentId}`;

        // 1. Remove users who haven't updated in 30 seconds
        const thirtySecondsAgo = Date.now() - 30000;
        await redisClient.zRemRangeByScore(setKey, 0, thirtySecondsAgo);

        // 2. Get remaining active user IDs
        const activeUserIds = await redisClient.zRange(setKey, 0, -1);

        if (activeUserIds.length === 0) {
            return res.json({ users: [] });
        }

        // 3. Fetch details for each user
        const results = await Promise.all(activeUserIds.map(userId =>
            redisClient.get(`presence:${documentId}:${userId}`)
        ));

        const users = results
            .map(data => data ? JSON.parse(data) : null)
            .filter(user => user !== null);

        res.json({ users });
    } catch (error) {
        console.error('Error fetching presence:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

const start = async () => {
    await redisClient.connect();
    app.listen(PORT, () => {
        console.log(`[${INSTANCE_ID}] Presence Service running on port ${PORT}`);
    });
};

start();
