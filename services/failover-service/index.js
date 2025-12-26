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

// New: Master registry to track the authoritative master and prevent split-brain
const CURRENT_MASTER_KEY = 'pg:current_master';
const MASTER_TTL = 3600; // 1 hour, refreshed each monitoring cycle

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
 * Stop a container (used for fencing rogue masters)
 */
async function stopContainer(containerName) {
    try {
        const container = docker.getContainer(containerName);
        console.log(`[Failover] Stopping ${containerName}...`);
        await container.stop({ t: 5 });
        console.log(`[Failover] Successfully stopped ${containerName}`);
        return true;
    } catch (err) {
        if (err.statusCode === 304) {
            console.log(`[Failover] ${containerName} is already stopped`);
            return true;
        }
        console.error(`[Failover] Failed to stop ${containerName}: ${err.message}`);
        return false;
    }
}

/**
 * Reconfigure a replica to replicate from a new master
 * This wipes the replica's data and runs pg_basebackup from the new master
 */
async function reconfigureReplicaToNewMaster(replicaName, newMasterHost) {
    console.log(`[Failover] Reconfiguring ${replicaName} to follow new master ${newMasterHost}...`);

    try {
        const container = docker.getContainer(replicaName);

        // Step 1: Stop the replica
        console.log(`[Failover] Stopping ${replicaName} for reconfiguration...`);
        try {
            await container.stop({ t: 10 });
        } catch (stopErr) {
            if (stopErr.statusCode !== 304) throw stopErr;
        }

        // Step 2: Start container temporarily to run setup commands
        await container.start();
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Step 3: Run reconfiguration script
        const reconfigScript = `
            set -e
            echo "Wiping data directory..."
            rm -rf /var/lib/postgresql/data/*
            
            echo "Waiting for new master ${newMasterHost} to be ready..."
            until PGPASSWORD=secret pg_isready -h "${newMasterHost}" -U editor -q; do
                sleep 2
            done
            
            echo "Running pg_basebackup from ${newMasterHost}..."
            PGPASSWORD='replicator_password' pg_basebackup \\
                -h "${newMasterHost}" \\
                -D /var/lib/postgresql/data \\
                -U replicator \\
                -v -P -R -X stream
            
            touch /var/lib/postgresql/data/standby.signal
            
            # Inject application_name for synchronous replication
            echo "primary_conninfo = 'user=replicator password=replicator_password host=${newMasterHost} port=5432 sslmode=prefer sslcompression=0 gssencmode=prefer krbsrvname=postgres target_session_attrs=any application_name=${replicaName}'" >> /var/lib/postgresql/data/postgresql.auto.conf
            
            chown -R postgres:postgres /var/lib/postgresql/data
            chmod 700 /var/lib/postgresql/data
            
            echo "Reconfiguration complete!"
        `;

        const exec = await container.exec({
            Cmd: ['bash', '-c', reconfigScript],
            AttachStdout: true,
            AttachStderr: true,
            User: 'root'
        });

        const stream = await exec.start();

        await new Promise((resolve, reject) => {
            let output = '';
            stream.on('data', (chunk) => {
                output += chunk.toString();
                console.log(`[Reconfig-${replicaName}] ${chunk.toString().trim()}`);
            });
            stream.on('end', () => {
                console.log(`[Failover] Reconfiguration of ${replicaName} completed`);
                resolve(output);
            });
            stream.on('error', reject);
        });

        // Step 4: Restart the container to apply changes
        await container.restart({ t: 10 });
        console.log(`[Failover] ${replicaName} restarted and now replicating from ${newMasterHost}`);

        return true;
    } catch (err) {
        console.error(`[Failover] Failed to reconfigure ${replicaName}:`, err.message);
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

    // Get the registered master from Redis (if any)
    let registeredMaster = null;
    try {
        registeredMaster = await redisClient.get(CURRENT_MASTER_KEY);
    } catch (err) {
        console.warn('[Failover] Could not fetch registered master from Redis:', err.message);
    }

    let masterNode = null;
    let healthyReplicas = [];
    let nodeStatuses = [];
    let rogueMasterDetected = false;

    for (const node of DB_NODES) {
        const status = await checkNode(node);

        if (status.up) {
            if (!status.isReadOnly) {
                // Node is reporting as master (read-write mode)

                // Check for rogue master: if there's a registered master and this isn't it
                if (registeredMaster && node.name !== registeredMaster) {
                    console.warn(`[Failover] 🚨 ROGUE MASTER DETECTED: ${node.name} is running as master but ${registeredMaster} is the registered master!`);
                    nodeStatuses.push(`${node.name}: ROGUE MASTER (stopping...)`);
                    rogueMasterDetected = true;

                    // FENCING: Stop the rogue master immediately
                    await stopContainer(node.name);
                    continue;
                }

                masterNode = node;
                nodeStatuses.push(`${node.name}: MASTER`);

                // Refresh the master registration in Redis
                if (registeredMaster === node.name) {
                    try {
                        await redisClient.expire(CURRENT_MASTER_KEY, MASTER_TTL);
                    } catch (err) {
                        // Non-critical, continue
                    }
                }
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
    const registeredInfo = registeredMaster ? ` [Registered: ${registeredMaster}]` : '';
    console.log(`[Failover] Cluster Status:${registeredInfo} ${nodeStatuses.join(' | ')}`);

    // Skip failover if we just handled a rogue master
    if (rogueMasterDetected) {
        console.log('[Failover] Rogue master handled. Skipping normal failover logic this cycle.');
        return;
    }

    // Failover logic: No master detected and we have healthy replicas
    if (!masterNode && healthyReplicas.length > 0) {
        const masterFailureCount = failureCounts['postgres-master'] || 0;

        // Also check if the registered master (if different from postgres-master) is down
        const registeredMasterFailCount = registeredMaster ? (failureCounts[registeredMaster] || 0) : 0;
        const shouldFailover = masterFailureCount >= FAIL_THRESHOLD ||
            (registeredMaster && registeredMasterFailCount >= FAIL_THRESHOLD);

        if (shouldFailover) {
            console.log('[Failover] Master is confirmed DOWN. Initiating failover...');

            // FENCING: Attempt to stop the old master container(s) to prevent split-brain
            const containersToFence = ['postgres-master'];
            if (registeredMaster && registeredMaster !== 'postgres-master') {
                containersToFence.push(registeredMaster);
            }

            for (const containerName of containersToFence) {
                try {
                    console.log(`[Failover] FENCING: Attempting to stop ${containerName}...`);
                    await stopContainer(containerName);
                    console.log(`[Failover] FENCING: ${containerName} stopped.`);
                } catch (fenceErr) {
                    console.warn(`[Failover] FENCING WARNING: Failed to stop ${containerName}: ${fenceErr.message}`);
                }
            }

            const target = healthyReplicas[0];
            try {
                await promoteReplica(target.name);
                console.log(`[Failover] Successfully promoted ${target.name} to new Master!`);

                // CRITICAL: Register the new master in Redis
                try {
                    await redisClient.set(CURRENT_MASTER_KEY, target.name, 'EX', MASTER_TTL);
                    console.log(`[Failover] ✓ Registered ${target.name} as the new master in Redis`);
                } catch (redisErr) {
                    console.error(`[Failover] WARNING: Failed to register new master in Redis: ${redisErr.message}`);
                }

                // Wait for new master to stabilize
                console.log('[Failover] Waiting for new master to stabilize...');
                await new Promise(resolve => setTimeout(resolve, 5000));

                // Run migrations against the new master to ensure schema exists
                await runMigrations(target.name);

                // Reconfigure remaining replicas to follow the new master
                const remainingReplicas = healthyReplicas.filter(r => r.name !== target.name);
                if (remainingReplicas.length > 0) {
                    console.log(`[Failover] Reconfiguring remaining replicas to follow new master: ${remainingReplicas.map(r => r.name).join(', ')}`);

                    // Reconfigure each replica (this wipes data and runs pg_basebackup)
                    for (const replica of remainingReplicas) {
                        await reconfigureReplicaToNewMaster(replica.name, target.name);
                    }
                }

                await restartDependentServices();
                console.log('[Failover] ✓ Failover complete! All services now using new master.');

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

    // Wait for Redis to be ready
    await new Promise(resolve => {
        if (redisClient.status === 'ready') {
            resolve();
        } else {
            redisClient.once('ready', resolve);
        }
    });

    // Initialize master registry if not set
    try {
        const existingMaster = await redisClient.get(CURRENT_MASTER_KEY);
        if (!existingMaster) {
            // Check if postgres-master is actually running as master
            const masterStatus = await checkNode(DB_NODES[0]); // postgres-master
            if (masterStatus.up && !masterStatus.isReadOnly) {
                await redisClient.set(CURRENT_MASTER_KEY, 'postgres-master', 'EX', MASTER_TTL);
                console.log('[Failover] ✓ Initialized master registry with postgres-master');
            } else {
                console.log('[Failover] postgres-master is not running as master, skipping initial registration');
            }
        } else {
            console.log(`[Failover] Master registry already set: ${existingMaster}`);
        }
    } catch (err) {
        console.warn('[Failover] Could not initialize master registry:', err.message);
    }

    setTimeout(() => {
        setInterval(monitor, CHECK_INTERVAL);
        monitor();
    }, 10000);
}

start();
