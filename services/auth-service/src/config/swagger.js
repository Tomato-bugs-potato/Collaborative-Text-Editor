const swaggerJsdoc = require('swagger-jsdoc');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Auth Service API',
            version: '1.0.0',
            description: 'Authentication service for user management and JWT tokens',
        },
        servers: [
            {
                url: 'http://localhost:3001',
                description: 'Auth Service',
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
    },
    apis: ['./index.js'], // Path to the API docs
};

const specs = swaggerJsdoc(options);

module.exports = specs;
