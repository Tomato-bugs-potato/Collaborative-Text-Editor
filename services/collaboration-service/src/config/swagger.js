const swaggerJsdoc = require('swagger-jsdoc');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Collaboration Service API',
            version: '1.0.0',
            description: 'API for real-time collaboration and operational transformation',
        },
        servers: [
            {
                url: 'http://localhost:3003',
                description: 'Development server',
            },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                },
            },
        },
        security: [
            {
                bearerAuth: [],
            },
        ],
    },
    apis: ['./index.js'], // Path to the API docs
};

const specs = swaggerJsdoc(options);

module.exports = specs;
