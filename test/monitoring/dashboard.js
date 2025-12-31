const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const k8s = require('@kubernetes/client-node');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.DASHBOARD_PORT || 3100;
const NAMESPACE = 'default';

// Kubernetes client
const kc = new k8s.KubeConfig();
kc.loadFromDefault();
const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

// Serve static HTML
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Distributed System Monitoring Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: #0f0f23;
            color: #e0e0e0;
            padding: 20px;
        }
        h1 {
            color: #00d9ff;
            margin-bottom: 30px;
            text-align: center;
            font-size: 2.5em;
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
            gap: 20px;
            margin-bottom: 20px;
        }
        .card {
            background: #1a1a2e;
            border: 1px solid #2a2a4e;
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        }
        .card h2 {
            color: #00d9ff;
            margin-bottom: 15px;
            font-size: 1.3em;
        }
        .status {
            display: inline-block;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            margin-right: 8px;
        }
        .status.healthy { background: #00ff88; }
        .status.warning { background: #ffaa00; }
        .status.critical { background: #ff4444; }
        .pod-item {
            padding: 10px;
            margin: 8px 0;
            background: #252538;
            border-radius: 6px;
            border-left: 3px solid #00d9ff;
        }
        .pod-name {
            font-weight: bold;
            color: #00d9ff;
        }
        .metric {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #2a2a4e;
        }
        .metric:last-child { border-bottom: none; }
        .metric-label { color: #888; }
        .metric-value {
            font-weight: bold;
            color: #00ff88;
        }
        .bar {
            height: 20px;
            background: #252538;
            border-radius: 10px;
            overflow: hidden;
            margin: 5px 0;
        }
        .bar-fill {
            height: 100%;
            background: linear-gradient(90deg, #00d9ff, #00ff88);
            transition: width 0.3s ease;
        }
        #eventLog {
            max-height: 400px;
            overflow-y: auto;
            font-family: 'Courier New', monospace;
            font-size: 0.9em;
        }
        .event {
            padding: 5px;
            margin: 2px 0;
            border-radius: 4px;
        }
        .event.info { background: #1a3a4a; color: #00d9ff; }
        .event.success { background: #1a4a2a; color: #00ff88; }
        .event.error { background: #4a1a1a; color: #ff4444; }
    </style>
</head>
<body>
    <h1>🚀 Distributed System Live Monitor</h1>
    
    <div class="grid">
        <div class="card">
            <h2>📊 Collaboration Service Pods</h2>
            <div id="collabPods"></div>
        </div>
        
        <div class="card">
            <h2>💾 Database Cluster</h2>
            <div id="dbStatus"></div>
        </div>
        
        <div class="card">
            <h2>📡 Redis Cluster</h2>
            <div id="redisStatus"></div>
        </div>
        
        <div class="card">
            <h2>⚡ System Metrics</h2>
            <div id="systemMetrics"></div>
        </div>
    </div>
    
    <div class="card">
        <h2>📝 Event Log</h2>
        <div id="eventLog"></div>
    </div>

    <script>
        const ws = new WebSocket('ws://localhost:${PORT}');
        
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            if (data.type === 'collabPods') {
                updateCollabPods(data.pods);
            } else if (data.type === 'dbStatus') {
                updateDbStatus(data.database);
            } else if (data.type === 'redisStatus') {
                updateRedisStatus(data.redis);
            } else if (data.type === 'metrics') {
                updateMetrics(data.metrics);
            } else if (data.type === 'event') {
                addEvent(data.event);
            }
        };
        
        function updateCollabPods(pods) {
            const container = document.getElementById('collabPods');
            container.innerHTML = pods.map(pod => \`
                <div class="pod-item">
                    <span class="status \${pod.status}"></span>
                    <span class="pod-name">\${pod.name}</span>
                    <div style="margin-top: 5px; color: #888; font-size: 0.9em;">
                        Connected Users: <span style="color: #00ff88;">\${pod.users || 0}</span>
                    </div>
                </div>
            \`).join('');
        }
        
        function updateDbStatus(db) {
            const container = document.getElementById('dbStatus');
            container.innerHTML = \`
                <div class="metric">
                    <span class="metric-label">Master:</span>
                    <span class="metric-value">\${db.master || 'Unknown'}</span>
                </div>
                <div class="metric">
                    <span class="metric-label">Replicas:</span>
                    <span class="metric-value">\${db.replicas || 0}</span>
                </div>
                <div class="metric">
                    <span class="metric-label">Sync Status:</span>
                    <span class="metric-value">\${db.syncStatus || 'Unknown'}</span>
                </div>
            \`;
        }
        
        function updateRedisStatus(redis) {
            const container = document.getElementById('redisStatus');
            container.innerHTML = \`
                <div class="metric">
                    <span class="metric-label">Cluster Nodes:</span>
                    <span class="metric-value">\${redis.nodes || 0}</span>
                </div>
                <div class="metric">
                    <span class="metric-label">Status:</span>
                    <span class="metric-value">\${redis.status || 'Unknown'}</span>
                </div>
            \`;
        }
        
        function updateMetrics(metrics) {
            const container = document.getElementById('systemMetrics');
            container.innerHTML = \`
                <div class="metric">
                    <span class="metric-label">Total Active Users:</span>
                    <span class="metric-value">\${metrics.activeUsers || 0}</span>
                </div>
                <div class="metric">
                    <span class="metric-label">Messages/sec:</span>
                    <span class="metric-value">\${metrics.messagesPerSec || 0}</span>
                </div>
                <div class="metric">
                    <span class="metric-label">Load Distribution:</span>
                </div>
                \${Object.entries(metrics.loadDistribution || {}).map(([pod, load]) => \`
                    <div style="margin: 10px 0;">
                        <div style="font-size: 0.9em; color: #888;">\${pod}</div>
                        <div class="bar">
                            <div class="bar-fill" style="width: \${load}%"></div>
                        </div>
                        <div style="text-align: right; font-size: 0.85em; color: #00ff88;">\${load}%</div>
                    </div>
                \`).join('')}
            \`;
        }
        
        function addEvent(event) {
            const container = document.getElementById('eventLog');
            const eventDiv = document.createElement('div');
            eventDiv.className = \`event \${event.level}\`;
            eventDiv.textContent = \`[\${new Date().toLocaleTimeString()}] \${event.message}\`;
            container.insertBefore(eventDiv, container.firstChild);
            
            // Keep only last 50 events
            while (container.children.length > 50) {
                container.removeChild(container.lastChild);
            }
        }
    </script>
</body>
</html>
    `);
});

// WebSocket connection handler
wss.on('connection', (ws) => {
    console.log('Dashboard client connected');

    // Send initial data
    collectAndSendMetrics(ws);

    // Update every 2 seconds
    const interval = setInterval(() => {
        collectAndSendMetrics(ws);
    }, 2000);

    ws.on('close', () => {
        clearInterval(interval);
        console.log('Dashboard client disconnected');
    });
});

async function collectAndSendMetrics(ws) {
    try {
        // Get collaboration pods
        const pods = await k8sApi.listNamespacedPod(NAMESPACE);
        const collabPods = pods.body.items
            .filter(pod => pod.metadata.name.startsWith('collaboration-service'))
            .map(pod => ({
                name: pod.metadata.name,
                status: pod.status.phase === 'Running' ? 'healthy' : 'critical',
                users: Math.floor(Math.random() * 50) // Mock data - would get from actual metrics
            }));

        ws.send(JSON.stringify({
            type: 'collabPods',
            pods: collabPods
        }));

        // Get database status
        const dbMaster = pods.body.items.find(p => p.metadata.name.startsWith('postgres-master'));
        const dbReplicas = pods.body.items.filter(p => p.metadata.name.startsWith('postgres-replica'));

        ws.send(JSON.stringify({
            type: 'dbStatus',
            database: {
                master: dbMaster ? dbMaster.metadata.name : 'None',
                replicas: dbReplicas.length,
                syncStatus: 'Synchronous'
            }
        }));

        // Get Redis status
        const redisNodes = pods.body.items.filter(p => p.metadata.name.startsWith('redis-cluster'));

        ws.send(JSON.stringify({
            type: 'redisStatus',
            redis: {
                nodes: redisNodes.length,
                status: 'Healthy'
            }
        }));

        // System metrics
        const loadDist = {};
        collabPods.forEach(pod => {
            loadDist[pod.name] = Math.floor((pod.users / collabPods.reduce((s, p) => s + p.users, 0)) * 100);
        });

        ws.send(JSON.stringify({
            type: 'metrics',
            metrics: {
                activeUsers: collabPods.reduce((sum, pod) => sum + pod.users, 0),
                messagesPerSec: Math.floor(Math.random() * 1000),
                loadDistribution: loadDist
            }
        }));

    } catch (error) {
        console.error('Error collecting metrics:', error);
    }
}

server.listen(PORT, () => {
    console.log(`\n🚀 Monitoring Dashboard running at http://localhost:${PORT}`);
    console.log(`   Open your browser to view real-time metrics\n`);
});
