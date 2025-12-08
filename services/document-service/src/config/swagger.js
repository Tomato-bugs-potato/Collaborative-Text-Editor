const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Document Service API',
      version: '1.0.0',
      description: 'Document management service for CRUD operations on documents',
    },
    servers: [
      {
        url: 'http://localhost:3002',
        description: 'Document Service',
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
  apis: ['./index.js'],
};

const specs = swaggerJsdoc(options);

module.exports = specs;
