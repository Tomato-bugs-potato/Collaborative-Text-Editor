const { PrismaClient } = require('@prisma/client');

// Internal state
let _currentClient = null;
let _currentReadClient = null;
let _currentMasterHost = null;
let _currentReadHost = null;

const masterUrl = process.env.DATABASE_URL;
const replicaHosts = [
  process.env.DB_REPLICA_1,
  process.env.DB_REPLICA_2
].filter(Boolean);

/**
 * Create a delegating wrapper that forwards all property access and method calls
 * to the current internal client. This allows the exported object to stay the same
 * while the underlying client changes.
 */
function createDelegatingClient(getClient) {
  return new Proxy({}, {
    get(target, prop) {
      const client = getClient();
      if (!client) {
        throw new Error('[Prisma] No database client available');
      }
      const value = client[prop];
      if (typeof value === 'function') {
        return value.bind(client);
      }
      return value;
    }
  });
}

/**
 * Smart Master Discovery
 */
async function discoverMaster() {
  const allHosts = [];
  if (masterUrl) {
    const match = masterUrl.match(/@([^:]+):/);
    if (match) allHosts.push(match[1]);
  }
  replicaHosts.forEach(h => {
    if (!allHosts.includes(h)) allHosts.push(h);
  });

  console.log(`[Prisma] Discovering master among: ${allHosts.join(', ')}`);

  const results = await Promise.all(allHosts.map(async (host) => {
    let testClient = null;
    try {
      const urlParts = masterUrl.match(/postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
      if (!urlParts) return { host, healthy: false, error: 'Invalid URL' };

      const [_, user, pass, oldHost, port, db] = urlParts;
      const testUrl = `postgresql://${user}:${pass}@${host}:${port}/${db}`;

      testClient = new PrismaClient({
        datasources: { db: { url: testUrl } },
        log: []
      });

      const result = await testClient.$queryRaw`SELECT pg_is_in_recovery()`;
      const isReadOnly = result[0].pg_is_in_recovery;

      console.log(`[Prisma] Host ${host}: healthy=true, isReadOnly=${isReadOnly}`);
      return { host, healthy: true, isReadOnly, client: testClient, url: testUrl };
    } catch (err) {
      if (testClient) await testClient.$disconnect().catch(() => { });
      console.warn(`[Prisma] Host ${host} check failed: ${err.message.substring(0, 50)}`);
      return { host, healthy: false, error: err.message };
    }
  }));

  const master = results.find(r => r.healthy && !r.isReadOnly);
  const replicas = results.filter(r => r.healthy && r.isReadOnly);

  console.log(`[Prisma] Discovery: master=${master?.host || 'NONE'}, replicas=[${replicas.map(r => r.host).join(', ')}]`);

  // Update Master
  if (master) {
    if (master.host !== _currentMasterHost) {
      console.log(`[Prisma] *** SWITCHING MASTER: ${_currentMasterHost} -> ${master.host} ***`);
      if (_currentClient) {
        await _currentClient.$disconnect().catch(() => { });
      }
      _currentClient = master.client;
      _currentMasterHost = master.host;
    } else {
      await master.client.$disconnect().catch(() => { });
    }
  } else {
    console.warn('[Prisma] WARNING: No writable master found!');
  }

  // Update Replica for reads
  if (replicas.length > 0) {
    const replica = replicas[Math.floor(Math.random() * replicas.length)];
    if (replica.host !== _currentReadHost) {
      console.log(`[Prisma] Switching read replica: ${_currentReadHost} -> ${replica.host}`);
      if (_currentReadClient && _currentReadClient !== _currentClient) {
        await _currentReadClient.$disconnect().catch(() => { });
      }
      _currentReadClient = replica.client;
      _currentReadHost = replica.host;
    } else {
      await replica.client.$disconnect().catch(() => { });
    }
  } else if (_currentClient) {
    console.log(`[Prisma] No healthy replicas, using master for reads`);
    if (_currentReadClient && _currentReadClient !== _currentClient) {
      await _currentReadClient.$disconnect().catch(() => { });
    }
    _currentReadClient = _currentClient;
    _currentReadHost = _currentMasterHost;
  }

  // Disconnect unused clients
  for (const r of results) {
    if (r.healthy && r.client !== _currentClient && r.client !== _currentReadClient) {
      await r.client.$disconnect().catch(() => { });
    }
  }
}

// Initialize with default client for Prisma migrations
_currentClient = new PrismaClient();
_currentReadClient = _currentClient;

// Start discovery after a delay to allow migrations to complete
setTimeout(() => {
  discoverMaster().catch(err => console.error('[Prisma] Discovery failed:', err));

  // Periodically refresh discovery
  setInterval(() => {
    discoverMaster().catch(err => console.error('[Prisma] Periodic discovery failed:', err));
  }, 10000);
}, 3000);

// Export delegating proxies - these always forward to the current internal client
module.exports = {
  prisma: createDelegatingClient(() => _currentClient),
  prismaRead: createDelegatingClient(() => _currentReadClient)
};
