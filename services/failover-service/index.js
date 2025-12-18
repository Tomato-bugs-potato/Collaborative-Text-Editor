require('dotenv').config();
const { Client } = require('pg');
const Redis = require('ioredis');
const Docker = require('dockerode');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// Services that depend on the database and need restart after failover
const DEPENDENT_SERVICES = [
    'auth-service-1',
    'auth-service-2',
    'document-service-1',
    'document-service-2',
    'collaboration-service-1',
    'collaboration-service-2',
    'collaboration-service-3',
    'reconciliation-service-1',
    'reconciliation-service-2'
];

// Use ioredis for robust Cluster support
const redisClient = new Redis.Cluster([
    { host: 'redis-node-1', port: 7001 },
    { host: 'redis-node-2', port: 7002 },
    { host: 'redis-node-3', port: 7003 }
], {
    redisOptions: {
        password: process.env.REDIS_PASSWORD,
        connectTimeout: 5000
    },
    scaleReads: 'slave',
    clusterRetryStrategy: (times) => Math.min(times * 100, 2000)
});

const DB_NODES = [
    { name: 'postgres-master', host: 'postgres-master', port: 5432 },
    { name: 'postgres-replica-1', host: 'postgres-replica-1', port: 5432 },
    { name: 'postgres-replica-2', host: 'postgres-replica-2', port: 5432 }
];

const CHECK_INTERVAL = 5000;
const FAIL_THRESHOLD = 3;
const LEADER_KEY = 'failover_service_leader';
const LEADER_TTL = 10;

let failureCounts = {};
let isLeader = false;

redisClient.on('error', (err) => {
    if (!err.message.includes('ECONNREFUSED')) {
        console.error('[Failover] Redis Cluster Error:', err.message);
    }
});

redisClient.on('ready', () => {
    console.log('[Failover] Redis Cluster is ready');
});

async function checkNode(node) {
    const client = new Client({
        host: node.host,
        port: node.port,
        user: process.env.DB_USER || 'editor',
        password: process.env.DB_PASSWORD || 'secret',
        database: 'postgres',
        connectionTimeoutMillis: 3000
    });

    try {
        await client.connect();
        const res = await client.query('SELECT pg_is_in_recovery()');
        await client.end();
        return { up: true, isReadOnly: res.rows[0].pg_is_in_recovery };
    } catch (err) {
        try { await client.end(); } catch (e) { /* ignore */ }
        return { up: false, error: err.message };
    }
}

async function promoteReplica(nodeName) {
    console.log(`[Failover] Promoting ${nodeName} to Master...`);
    try {
        const container = docker.getContainer(nodeName);

        // Use full path to pg_ctl in PostgreSQL Docker image
        const exec = await container.exec({
            Cmd: ['su', '-', 'postgres', '-c', '/usr/lib/postgresql/15/bin/pg_ctl promote -D /var/lib/postgresql/data'],
            AttachStdout: true,
            AttachStderr: true
        });
        const stream = await exec.start();

        return new Promise((resolve, reject) => {
            let output = '';
            stream.on('data', (chunk) => {
                output += chunk.toString();
            });
            stream.on('end', () => {
                console.log(`[Failover] Promotion output: ${output}`);
                resolve(output);
            });
            stream.on('error', reject);
        });
    } catch (err) {
        console.error(`[Failover] Failed to promote ${nodeName}:`, err.message);
        throw err;
    }
}

/**
 * Restart a single container
 */
async function restartContainer(containerName) {
    try {
        const container = docker.getContainer(containerName);
        console.log(`[Failover] Restarting ${containerName}...`);
        await container.restart({ t: 10 }); // 10 second timeout
        console.log(`[Failover] Successfully restarted ${containerName}`);
        return true;
    } catch (err) {
        console.error(`[Failover] Failed to restart ${containerName}: ${err.message}`);
        return false;
    }
}

/**
 * Restart all dependent services after failover
 */
async function restartDependentServices() {
    console.log('[Failover] Restarting dependent services to pick up new master...');

    // Wait a moment for the promoted replica to fully become master
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Restart services in parallel
    const results = await Promise.all(
        DEPENDENT_SERVICES.map(service => restartContainer(service))
    );

    const successCount = results.filter(r => r).length;
    console.log(`[Failover] Restarted ${successCount}/${DEPENDENT_SERVICES.length} services`);

    return successCount === DEPENDENT_SERVICES.length;
}

// Configuration for services that need migrations
const MIGRATION_SERVICES = [
    { container: 'auth-service-1', db: 'texteditor' },
    { container: 'document-service-1', db: 'texteditor_docs' },
    { container: 'collaboration-service-1', db: 'texteditor_collab' }
];

/**
 * Run Prisma migrations against the new master
 */
async function runMigrations(masterHost) {
    console.log(`[Failover] Running migrations against new master: ${masterHost}`);

    for (const service of MIGRATION_SERVICES) {
        try {
            console.log(`[Failover] Triggering migration for ${service.db} via ${service.container}...`);
            const container = docker.getContainer(service.container);

            // Construct connection string for the new master
            const dbUrl = `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${masterHost}:5432/${service.db}`;

            const exec = await container.exec({
                Cmd: ['sh', '-c', `DATABASE_URL="${dbUrl}" npx prisma db push --skip-generate`],
                AttachStdout: true,
                AttachStderr: true
            });

            const stream = await exec.start();

            // Wait for command to finish
            await new Promise((resolve, reject) => {
                stream.on('data', (chunk) => console.log(`[Migration-${service.db}] ${chunk.toString().trim()}`));
                stream.on('end', resolve);
                stream.on('error', reject);
            });

            console.log(`[Failover] Migration command sent to ${service.container}`);
        } catch (err) {
            console.error(`[Failover] Failed to run migration for ${service.db}:`, err.message);
            // Don't throw, continue with other services/restarts
        }
    }
}

async function runElection() {
    try {
        const result = await redisClient.set(LEADER_KEY, 'leader', 'NX', 'EX', LEADER_TTL);
        isLeader = (result === 'OK');

        if (!isLeader) {
            const currentLeader = await redisClient.get(LEADER_KEY);
            if (currentLeader === 'leader') {
                await redisClient.expire(LEADER_KEY, LEADER_TTL);
                isLeader = true;
            }
        }
    } catch (err) {
        if (!isLeader) {
            console.warn('[Failover] Redis election failed, assuming leadership fallback');
            isLeader = true;
        }
    }
}

async function monitor() {
    await runElection();

    if (!isLeader) {
        return;
    }

    let masterNode = null;
    let healthyReplicas = [];
    let nodeStatuses = [];

    for (const node of DB_NODES) {
        const status = await checkNode(node);

        if (status.up) {
            if (!status.isReadOnly) {
                masterNode = node;
                nodeStatuses.push(`${node.name}: MASTER`);
            } else {
                healthyReplicas.push(node);
                nodeStatuses.push(`${node.name}: REPLICA (healthy)`);
            }
            failureCounts[node.name] = 0;
        } else {
            failureCounts[node.name] = (failureCounts[node.name] || 0) + 1;
            nodeStatuses.push(`${node.name}: DOWN (${failureCounts[node.name]}/${FAIL_THRESHOLD}) - ${status.error?.substring(0, 50) || 'unknown'}`);
        }
    }

    // Log cluster status every cycle for visibility
    console.log(`[Failover] Cluster Status: ${nodeStatuses.join(' | ')}`);

    // Failover logic
    if (!masterNode && healthyReplicas.length > 0) {
        const masterFailureCount = failureCounts['postgres-master'] || 0;
        if (masterFailureCount >= FAIL_THRESHOLD) {
            console.log('[Failover] Master is confirmed DOWN. Initiating failover...');
            const target = healthyReplicas[0];
            try {
                await promoteReplica(target.name);
                console.log(`[Failover] Successfully promoted ${target.name} to new Master!`);

                // AUTOMATIC SERVICE RESTART
                console.log('[Failover] Waiting for new master to stabilize...');

                // Run migrations against the new master to ensure schema exists
                await runMigrations(target.name);

                // Restart dependent services AND remaining replicas (to prevent stale reads)
                const remainingReplicas = healthyReplicas.filter(r => r.name !== target.name).map(r => r.name);
                if (remainingReplicas.length > 0) {
                    console.log(`[Failover] Restarting remaining replicas to force re-sync: ${remainingReplicas.join(', ')}`);
                    await Promise.all(remainingReplicas.map(name => restartContainer(name)));
                }

                await restartDependentServices();
                console.log('[Failover] Failover complete! All services should now use the new master.');

                failureCounts = {};
            } catch (err) {
                console.error('[Failover] Failover failed:', err.message);
            }
        }
    } else if (!masterNode && healthyReplicas.length === 0) {
        console.warn('[Failover] WARNING: No master AND no healthy replicas found! Cluster is in critical state.');
    }
}

async function start() {
    console.log('[Failover] Service starting...');
    console.log(`[Failover] Will restart these services on failover: ${DEPENDENT_SERVICES.join(', ')}`);
    setTimeout(() => {
        setInterval(monitor, CHECK_INTERVAL);
        monitor();
    }, 10000);
}

start();
