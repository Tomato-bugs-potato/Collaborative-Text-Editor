/**
 * Prometheus Metrics Utility
 * Provides a shared metrics setup for all microservices
 */

const client = require('prom-client');

// Create a Registry for metrics
const register = new client.Registry();

// Add default labels
const addDefaultLabels = (serviceName, instanceId) => {
    register.setDefaultLabels({
        service: serviceName,
        instance: instanceId || 'unknown'
    });
};

// Collect default metrics (CPU, memory, event loop, etc.)
const collectDefaultMetrics = () => {
    client.collectDefaultMetrics({ register });
};

// Custom metrics

// HTTP request duration histogram
const httpRequestDurationMicroseconds = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.001, 0.005, 0.015, 0.05, 0.1, 0.5, 1, 5]
});
register.registerMetric(httpRequestDurationMicroseconds);

// HTTP request counter
const httpRequestsTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code']
});
register.registerMetric(httpRequestsTotal);

// Active connections gauge
const activeConnections = new client.Gauge({
    name: 'active_connections',
    help: 'Number of active connections'
});
register.registerMetric(activeConnections);

// WebSocket connections gauge
const wsConnections = new client.Gauge({
    name: 'websocket_connections',
    help: 'Number of active WebSocket connections'
});
register.registerMetric(wsConnections);

// Kafka messages counter
const kafkaMessagesTotal = new client.Counter({
    name: 'kafka_messages_total',
    help: 'Total number of Kafka messages processed',
    labelNames: ['topic', 'type']
});
register.registerMetric(kafkaMessagesTotal);

// Database query duration histogram
const dbQueryDuration = new client.Histogram({
    name: 'db_query_duration_seconds',
    help: 'Duration of database queries in seconds',
    labelNames: ['operation', 'table'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1]
});
register.registerMetric(dbQueryDuration);

/**
 * Express middleware to track request metrics
 */
const metricsMiddleware = (req, res, next) => {
    const start = Date.now();

    res.on('finish', () => {
        const duration = (Date.now() - start) / 1000;
        const route = req.route ? req.route.path : req.path;

        httpRequestDurationMicroseconds
            .labels(req.method, route, res.statusCode)
            .observe(duration);

        httpRequestsTotal
            .labels(req.method, route, res.statusCode)
            .inc();
    });

    next();
};

/**
 * Setup metrics endpoint for Express app
 * @param {Express} app - Express application
 * @param {string} serviceName - Name of the service
 * @param {string} instanceId - Instance ID
 */
const setupMetrics = (app, serviceName, instanceId) => {
    addDefaultLabels(serviceName, instanceId);
    collectDefaultMetrics();

    // Add metrics middleware to track all requests
    app.use(metricsMiddleware);

    // Expose metrics endpoint
    app.get('/metrics', async (req, res) => {
        try {
            res.set('Content-Type', register.contentType);
            res.end(await register.metrics());
        } catch (err) {
            res.status(500).end(err.message);
        }
    });

    console.log(`[${instanceId}] Prometheus metrics enabled at /metrics`);
};

module.exports = {
    register,
    client,
    setupMetrics,
    metricsMiddleware,
    // Export individual metrics for custom use
    httpRequestDurationMicroseconds,
    httpRequestsTotal,
    activeConnections,
    wsConnections,
    kafkaMessagesTotal,
    dbQueryDuration
};
