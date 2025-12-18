const prismaClient = require('./shared-utils/prisma-client');

const connect = async () => {
    try {
        // The shared client handles discovery automatically
        console.log('Using shared Prisma client for database connection');
        // We can just check if it's ready by doing a simple query
        await prismaClient.prisma.$queryRaw`SELECT 1`;
        console.log('Connected to PostgreSQL database (Master) successfully');
    } catch (e) {
        console.log('Database connection error:', e);
        throw e;
    }
};

module.exports = {
    connect,
    get prisma() { return prismaClient.prisma; },
    get prismaRead() { return prismaClient.prismaRead; }
};
