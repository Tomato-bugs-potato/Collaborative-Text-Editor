const swaggerJsdoc = require('swagger-jsdoc');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Reconciliation Service API',
            version: '1.0.0',
            description: 'API for document reconciliation and conflict resolution',
        },
        servers: [
            {
                url: 'http://localhost:3004', // Assuming port 3004 based on docker-compose (wait, docker-compose says 3004? Let me check)
                description: 'Development server',
            },
        ],
    },
    apis: ['./index.js'],
};

const specs = swaggerJsdoc(options);

module.exports = specs;
