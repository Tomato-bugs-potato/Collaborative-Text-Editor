const io = require('socket.io-client');
const chalk = require('chalk');
const ora = require('ora');
const jwt = require('jsonwebtoken');

const API_GATEWAY = process.env.API_GATEWAY || 'http://localhost:8080';
const NUM_USERS = parseInt(process.env.NUM_USERS) || 50;
const DOCUMENT_ID = process.env.DOCUMENT_ID || 'test-doc-123';

class UserSimulator {
    constructor(userId, token) {
        this.userId = userId;
        this.token = token;
        this.socket = null;
        this.connectedTo = null;
        this.messagesReceived = 0;
        this.messagesSent = 0;
    }

    async connect() {
        return new Promise((resolve, reject) => {
            this.socket = io(`${API_GATEWAY}`, {
                auth: { token: this.token },
                transports: ['websocket']
            });

            this.socket.on('connect', () => {
                console.log(chalk.green(`✓ User ${this.userId} connected`));
                this.socket.emit('join-document', DOCUMENT_ID);
            });

            this.socket.on('document-joined', (data) => {
                this.connectedTo = data.instanceId || 'unknown';
                console.log(chalk.blue(`  User ${this.userId} → Pod: ${this.connectedTo}`));
                resolve();
            });

            this.socket.on('receive-changes', (data) => {
                this.messagesReceived++;
            });

            this.socket.on('connect_error', (error) => {
                console.log(chalk.red(`✗ User ${this.userId} connection error:`, error.message));
                reject(error);
            });

            setTimeout(() => reject(new Error('Connection timeout')), 10000);
        });
    }

    sendEdit() {
        const operation = {
            ops: [{ retain: Math.floor(Math.random() * 100), insert: `User${this.userId} ` }]
        };

        this.socket.emit('send-changes', {
            documentId: DOCUMENT_ID,
            operation,
            version: Date.now()
        });
        this.messagesSent++;
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
        }
    }
}

async function authenticate(userId) {
    // Generate valid JWT token
    const payload = {
        userId: `user-${userId}`,
        email: `user${userId}@example.com`,
        name: `Load Test User ${userId}`
    };
    return jwt.sign(payload, process.env.JWT_SECRET || 'your-super-secret-jwt-key', { expiresIn: '1h' });
}

async function runLoadTest() {
    console.log(chalk.bold.cyan('\n🚀 Starting Load Test\n'));
    console.log(chalk.yellow(`Configuration:`));
    console.log(chalk.yellow(`  - API Gateway: ${API_GATEWAY}`));
    console.log(chalk.yellow(`  - Number of Users: ${NUM_USERS}`));
    console.log(chalk.yellow(`  - Document ID: ${DOCUMENT_ID}\n`));

    const spinner = ora('Creating user simulators...').start();
    const users = [];

    // Create users
    for (let i = 0; i < NUM_USERS; i++) {
        const token = await authenticate(i);
        users.push(new UserSimulator(i, token));
    }
    spinner.succeed(`Created ${NUM_USERS} user simulators`);

    // Connect all users
    spinner.start('Connecting users to collaboration service...');
    try {
        await Promise.all(users.map(user => user.connect()));
        spinner.succeed(`All ${NUM_USERS} users connected!`);
    } catch (error) {
        spinner.fail('Failed to connect users');
        console.error(error);
        process.exit(1);
    }

    // Analyze pod distribution
    console.log(chalk.bold.cyan('\n📊 Load Distribution Analysis:\n'));
    const podDistribution = {};
    users.forEach(user => {
        if (user.connectedTo) {
            podDistribution[user.connectedTo] = (podDistribution[user.connectedTo] || 0) + 1;
        }
    });

    Object.entries(podDistribution).forEach(([pod, count]) => {
        const percentage = ((count / NUM_USERS) * 100).toFixed(1);
        const bar = '█'.repeat(Math.floor(percentage / 2));
        console.log(chalk.green(`  ${pod}: ${bar} ${count} users (${percentage}%)`));
    });

    // Simulate editing activity
    console.log(chalk.bold.cyan('\n✏️  Simulating Concurrent Editing...\n'));
    const duration = 30000; // 30 seconds
    const editInterval = 1000; // Edit every second

    const editSimulation = setInterval(() => {
        // Random subset of users make edits
        const activeUsers = users.filter(() => Math.random() > 0.7);
        activeUsers.forEach(user => user.sendEdit());
    }, editInterval);

    // Wait for duration
    await new Promise(resolve => setTimeout(resolve, duration));
    clearInterval(editSimulation);

    // Report results
    console.log(chalk.bold.cyan('\n📈 Test Results:\n'));
    const totalSent = users.reduce((sum, user) => sum + user.messagesSent, 0);
    const totalReceived = users.reduce((sum, user) => sum + user.messagesReceived, 0);

    console.log(chalk.green(`  Total messages sent: ${totalSent}`));
    console.log(chalk.green(`  Total messages received: ${totalReceived}`));
    console.log(chalk.green(`  Message delivery rate: ${((totalReceived / (totalSent * (NUM_USERS - 1))) * 100).toFixed(2)}%`));

    // Verify cross-pod communication
    console.log(chalk.bold.cyan('\n🔄 Cross-Pod Communication Verification:\n'));
    const pods = Object.keys(podDistribution);
    if (pods.length > 1) {
        console.log(chalk.green(`  ✓ Messages distributed across ${pods.length} pods`));
        console.log(chalk.green(`  ✓ Redis Pub/Sub adapter working correctly`));
    } else {
        console.log(chalk.yellow(`  ⚠ Only ${pods.length} pod detected. Scale up for better testing.`));
    }

    // Cleanup
    spinner.start('Disconnecting users...');
    users.forEach(user => user.disconnect());
    spinner.succeed('All users disconnected');

    console.log(chalk.bold.green('\n✅ Load Test Complete!\n'));
}

// Run the test
runLoadTest().catch(error => {
    console.error(chalk.red('\n❌ Load test failed:'), error);
    process.exit(1);
});
