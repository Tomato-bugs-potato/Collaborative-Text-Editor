require("dotenv").config();
const express = require('express');
const cors = require('cors');
const Redis = require('ioredis');
const { setupMetrics } = require('./shared-utils');

const app = express();
const PORT = process.env.PORT || 3005;
const INSTANCE_ID = process.env.INSTANCE_ID || 'presence-1';

// Setup Prometheus metrics
setupMetrics(app, 'presence-service', INSTANCE_ID);

// Parse Redis cluster nodes from env
const REDIS_NODES = (process.env.REDIS_NODES || 'redis-cluster-0.redis-cluster:6379').split(',');
const clusterNodes = REDIS_NODES.map(node => {
    const [host, port] = node.split(':');
    return { host, port: parseInt(port) || 6379 };
});

console.log(`[${INSTANCE_ID}] Connecting to Redis Cluster:`, clusterNodes.map(n => `${n.host}:${n.port}`).join(', '));

// Redis Cluster Client using ioredis
const redisClient = new Redis.Cluster(clusterNodes, {
    redisOptions: {
        password: undefined, // Set if Redis requires auth
    },
    scaleReads: 'slave',
    enableReadyCheck: true,
    maxRedirections: 16,
    retryDelayOnFailover: 100,
    clusterRetryStrategy: (times) => Math.min(times * 100, 3000)
});

redisClient.on('error', (err) => console.error(`[${INSTANCE_ID}] Redis Client Error:`, err.message));
redisClient.on('connect', () => console.log(`[${INSTANCE_ID}] Connecting to Redis...`));
redisClient.on('ready', () => console.log(`[${INSTANCE_ID}] ✓ Connected to Redis Cluster`));


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
/**
 * @swagger
 * /presence/{documentId}/{userId}:
 *   post:
 *     summary: Update user presence and cursor position
 *     tags: [Presence]
 *     parameters:
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Document ID
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               cursor:
 *                 type: number
 *                 description: Cursor position in document
 *               selection:
 *                 type: object
 *                 description: Current text selection
 *               name:
 *                 type: string
 *                 description: User display name
 *               color:
 *                 type: string
 *                 description: User cursor color
 *     responses:
 *       200:
 *         description: Presence updated successfully
 *       500:
 *         description: Internal server error
 */
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

        // Store in Redis with TTL (e.g., 30 seconds) - ioredis syntax
        await redisClient.set(key, data, 'EX', 30);

        // Add to sorted set for the document - ioredis syntax: zadd(key, score, member)
        const setKey = `doc_users:${documentId}`;
        await redisClient.zadd(setKey, Date.now(), userId);

        // Set expiry on the set itself too
        await redisClient.expire(setKey, 300);

        res.json({ status: 'ok' });
    } catch (error) {
        console.error('Error updating presence:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// Get active users for a document
/**
 * @swagger
 * /presence/{documentId}:
 *   get:
 *     summary: Get active users and their presence for a document
 *     tags: [Presence]
 *     parameters:
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Document ID
 *     responses:
 *       200:
 *         description: List of active users with cursor positions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       userId:
 *                         type: string
 *                       name:
 *                         type: string
 *                       color:
 *                         type: string
 *                       cursor:
 *                         type: number
 *                       selection:
 *                         type: object
 *                       lastSeen:
 *                         type: number
 *       500:
 *         description: Internal server error
 */
app.get('/presence/:documentId', async (req, res) => {
    try {
        const { documentId } = req.params;
        const setKey = `doc_users:${documentId}`;

        // Remove users who haven't updated in 30 seconds
        const thirtySecondsAgo = Date.now() - 30000;
        // ioredis syntax: zremrangebyscore(key, min, max)
        await redisClient.zremrangebyscore(setKey, 0, thirtySecondsAgo);

        // ioredis syntax: zrange(key, start, stop)
        const activeUserIds = await redisClient.zrange(setKey, 0, -1);

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

// Wait for Redis to be ready, then start the server
const start = async () => {
    // ioredis auto-connects, just wait for ready
    if (redisClient.status !== 'ready') {
        await new Promise((resolve, reject) => {
            redisClient.once('ready', resolve);
            redisClient.once('error', reject);
        });
    }

    app.listen(PORT, () => {
        console.log(`[${INSTANCE_ID}] Presence Service running on port ${PORT}`);
    });
};

start().catch(err => {
    console.error(`[${INSTANCE_ID}] Failed to start:`, err);
    process.exit(1);
});
