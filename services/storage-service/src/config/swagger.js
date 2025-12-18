const swaggerJsdoc = require('swagger-jsdoc');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Storage Service API',
            version: '1.0.0',
            description: 'API for file storage and retrieval',
        },
        servers: [
            {
                url: 'http://localhost:3006',
                description: 'Development server',
            },
        ],
    },
    apis: ['./index.js'],
};

const specs = swaggerJsdoc(options);

module.exports = specs;
