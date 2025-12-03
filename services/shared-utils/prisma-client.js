const { PrismaClient } = require('@prisma/client');

// Create and export Prisma client instance
const prisma = new PrismaClient({
  log: ['query', 'error', 'warn'],
});

// Handle connection and disconnection
prisma.$connect()
  .then(() => {
    console.log('Prisma client connected to database');
  })
  .catch((error) => {
    console.error('Failed to connect Prisma client:', error);
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Disconnecting Prisma client...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Disconnecting Prisma client...');
  await prisma.$disconnect();
  process.exit(0);
});

module.exports = prisma;
