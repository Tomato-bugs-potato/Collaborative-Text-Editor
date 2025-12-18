const swaggerJsdoc = require('swagger-jsdoc');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Presence Service API',
            version: '1.0.0',
            description: 'API for tracking user presence and cursor positions',
        },
        servers: [
            {
                url: 'http://localhost:3005',
                description: 'Development server',
            },
        ],
    },
    apis: ['./index.js'],
};

const specs = swaggerJsdoc(options);

module.exports = specs;
