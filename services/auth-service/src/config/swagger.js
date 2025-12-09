const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'collaborative text editor API',
      version: '1.0.0',
      description: 'Distrbuted and collaborative text editor ',
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
  apis: ['./index.js'],
};

const specs = swaggerJsdoc(options);

module.exports = specs;
