# Distributed System Testing Framework

Comprehensive testing suite to showcase and validate all distributed system capabilities.

## 🎯 Features

- **Load Distribution Testing** - Simulate 100+ concurrent users across multiple pods
- **Chaos Engineering** - Database and service failover tests
- **End-to-End Integration** - Complete user journey validation
- **Real-time Monitoring** - Live web dashboard with metrics
- **Automated CI/CD** - GitHub Actions integration
- **Manual Demo Mode** - One-command showcase execution

## 📁 Project Structure

```
test/
├── load-testing/
│   └── multi-user-simulator.js    # Concurrent user simulation
├── chaos/
│   ├── database-failover.test.js  # PostgreSQL failover test
│   └── redis-failover.test.js     # Redis cluster failover
├── e2e/
│   └── full-workflow.test.js      # Complete integration test
├── monitoring/
│   └── dashboard.js               # Real-time web dashboard
├── demo/
│   └── showcase.js                # Automated demo script
└── package.json
```

## 🚀 Quick Start

### Install Dependencies
```bash
cd test
npm install
```

### Run Individual Tests

**Load Testing:**
```bash
npm run test:load

# With custom parameters:
NUM_USERS=100 API_GATEWAY=http://localhost:8080 npm run test:load
```

**Failover Testing:**
```bash
npm run test:failover
```

**E2E Testing:**
```bash
npm run test:e2e
```

### Start Monitoring Dashboard
```bash
npm run dashboard

# Then open: http://localhost:3100
```

### Run Complete Showcase
```bash
npm run demo
```

This will:
1. Run load test with 50 users
2. Start monitoring dashboard
3. Execute failover test
4. Run E2E integration test
5. Display comprehensive results

## 📊 Test Scenarios

### 1. Load Distribution
**What it tests:**
- Multiple collaboration-service pods handling concurrent users
- Load balancing effectiveness
- Redis Pub/Sub cross-pod communication

**Expected Results:**
- Even distribution across pods (±10%)
- All users receive messages from all other users
- No message loss

### 2. Database Failover
**What it tests:**
- Automatic master promotion when master fails
- Zero data loss (synchronous replication)
- Remaining replicas reconfigure to new master
- Services automatically reconnect

**Expected Results:**
- Failover completes in <30 seconds
- No data loss
- System continues operating

### 3. Redis Cluster Resilience
**What it tests:**
- Redis node failure and recovery
- Collaboration service continues working
- Data remains accessible

**Expected Results:**
- Replica promoted to master
- WebSocket connections remain active
- Presence data intact

### 4. End-to-End Workflow
**What it validates:**
- User registration & authentication
- Document creation (CRUD)
- Real-time collaboration (WebSocket)
- Operational Transformation
- Snapshot storage (MinIO)
- Event streaming (Kafka)

## 🎨 Web Dashboard

The monitoring dashboard provides real-time visualization of:
- Active collaboration pods and user distribution
- Database cluster status (master + replicas)
- Redis cluster health
- System-wide metrics
- Live event log

Access at: `http://localhost:3100`

## 🔄 CI/CD Integration

Tests run automatically on:
- Every push to `main` or `develop`
- Pull requests
- Daily at 2 AM (scheduled)

### Required Secrets
Set these in your GitHub repository:
- `API_GATEWAY_URL` - Your API gateway endpoint
- `KUBE_CONFIG` - Kubernetes configuration for failover tests

## 📝 Manual Testing Commands

```bash
# Load test with specific user count
NUM_USERS=200 npm run test:load

# Failover test with custom namespace
NAMESPACE=production npm run test:failover

# E2E test against staging
API_GATEWAY=https://staging.example.com npm run test:e2e

# Start dashboard on custom port
DASHBOARD_PORT=4000 npm run dashboard
```

## 🎬 Demo Showcase

For presentations and demonstrations:

```bash
npm run demo
```

This runs all tests sequentially with enhanced output, perfect for showcasing the distributed system capabilities.

## ✅ Success Criteria

**Load Test:**
- ✓ All users connect successfully
- ✓ Load distributed across pods (max deviation <15%)
- ✓ Message delivery rate >95%

**Failover Test:**
- ✓ Master failure detected within 15s
- ✓ Replica promoted automatically
- ✓ Zero data loss confirmed
- ✓ Services reconnect successfully

**E2E Test:**
- ✓ All API endpoints respond correctly
- ✓ WebSocket connection established
- ✓ Real-time edits propagate
- ✓ Snapshots stored and retrievable

## 🐛 Troubleshooting

**Connection refused errors:**
- Ensure API Gateway is running
- Check `API_GATEWAY` environment variable
- Verify Kubernetes port forwarding

**Failover test fails:**
- Ensure you have Kubernetes access (`kubectl get pods`)
- Check `KUBE_CONFIG` is correctly set
- Verify failover-service is running

**Dashboard shows no data:**
- Verify Kubernetes API access
- Check if pods are running (`kubectl get pods`)
- Ensure metrics endpoints are accessible

## 📖 Documentation

- [Implementation Plan](../docs/testing-framework-plan.md)
- [Architecture](../docs/SYSTEM_ARCHITECTURE.md)
- [API Documentation](#) - Available at `/api-docs` on each service

## 🤝 Contributing

When adding new tests:
1. Create test file in appropriate directory
2. Add npm script in `package.json`
3. Update this README
4. Add to CI/CD pipeline if applicable

## 📄 License

Same as the main project.
