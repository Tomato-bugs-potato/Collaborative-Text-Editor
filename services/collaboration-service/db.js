const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: ['error', 'warn'],
});

const connect = async () => {
    try {
        await prisma.$connect()
        console.log('Connected to PostgreSQL database successfully')
    } catch (e) {
        console.log('Database connection error:', e)
        throw e
    }
}

module.exports = { connect, prisma }
