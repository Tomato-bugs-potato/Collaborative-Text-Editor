// Prisma client factory - services should pass their own PrismaClient
const createPrismaClient = (PrismaClient) => {
  const prisma = new PrismaClient({
    log: ['query', 'error', 'warn'],
  });

  return prisma;
};

module.exports = { createPrismaClient };
