# Distributed System Testing Guide

## 🎯 Testing Objectives

This guide will help you verify that your distributed system is working correctly by testing:
1. **System Health** - All services running
2. **Functional Tests** - Core features work
3. **Distributed Systems Tests** - Scalability, fault tolerance, replication
4. **Performance Tests** - Load balancing, caching

---

## 1. System Health Check

### Check All Containers Are Running

```bash
# View all running containers
docker-compose -f docker-compose.distributed.yml ps

# Expected: 28 containers in "Up" or "healthy" state
```

**Expected Services**:
- ✅ 3 PostgreSQL (master + 2 replicas)
- ✅ 6 Redis nodes + 1 init
- ✅ 3 Kafka brokers + 1 Zookeeper
- ✅ 2 API Gateways
- ✅ 2 Auth Services
- ✅ 2 Document Services
- ✅ 3 Collaboration Services
- ✅ 2 Reconciliation Services
- ✅ 1 Nginx
- ✅ 1 Client

### Check Service Health Endpoints

```bash
# API Gateway
curl http://localhost:4000/health
curl http://localhost:4001/health

# Auth Service
curl http://localhost:3001/health
curl http://localhost:3011/health

# Document Service
curl http://localhost:3002/health
curl http://localhost:3012/health

# Nginx
curl http://localhost/health
```

**Expected Response**: `{"success":true,"message":"... service is healthy"}`

---

## 2. Functional Tests

### Test 1: User Registration & Login

**Step 1: Register a New User**
1. Open http://localhost:3000
2. Click "Don't have an account? Sign up"
3. Enter:
   - Name: `Test User`
   - Email: `test@example.com`
   - Password: `Test123!@#`
4. Click "Create Account"

**Expected**: 
- ✅ Success message: "Account created! Please enter the verification code..."
- ✅ Verification screen appears
- ⚠️ Email sent (requires EmailJS configuration)

**Step 2: Verify Email** (if EmailJS configured)
1. Check email for verification code
2. Enter the 6-character code
3. Click "Verify Email"

**Expected**: 
- ✅ "Email verified! Logging you in..."
- ✅ Redirected to dashboard

**Step 3: Login**
1. Go to http://localhost:3000
2. Enter email and password
3. Click "Sign In"

**Expected**: 
- ✅ Logged in successfully
- ✅ Dashboard shows documents

### Test 2: Google OAuth Login

1. Click "Continue with Google"
2. Authenticate with Google
3. Redirected back to app

**Expected**: 
- ✅ Logged in without email verification
- ✅ User created in database

### Test 3: Document Creation

1. After login, click "New Document" or similar
2. Enter document title
3. Start typing in the editor

**Expected**: 
- ✅ Document created
- ✅ Content saves automatically
- ✅ Document appears in list

### Test 4: Real-time Collaboration

**Open 2 Browser Windows**:
1. Window 1: Login as User A
2. Window 2: Login as User B
3. User A creates a document and shares with User B
4. Both users open the same document
5. User A types something
6. User B types something

**Expected**: 
- ✅ Both users see each other's changes in real-time
- ✅ No conflicts or overwrites
- ✅ Cursor positions visible (if implemented)

---

## 3. Distributed Systems Tests

### Test 5: Load Balancing

**Test API Gateway Load Balancing**:

```bash
# Make multiple requests - should hit different gateways
for i in {1..10}; do
  curl -s http://localhost/health | grep -o "gateway-[12]"
done
```

**Expected**: Mix of `gateway-1` and `gateway-2` responses

**Test Service Load Balancing**:

```bash
# Check which auth service handles requests
for i in {1..10}; do
  curl -s http://localhost:3001/health
done
```

**Expected**: Requests distributed across auth-service-1 and auth-service-2

### Test 6: Database Replication

**Check Replication Status**:

```bash
# Connect to master
docker exec -it postgres-master psql -U editor -d texteditor -c "SELECT * FROM pg_stat_replication;"

# Should show 2 replicas connected
```

**Test Write-Read Replication**:

```bash
# Write to master
docker exec -it postgres-master psql -U editor -d texteditor -c "INSERT INTO users (email, name, password) VALUES ('replication@test.com', 'Replication Test', 'hash');"

# Read from replica (wait 1-2 seconds for replication)
docker exec -it postgres-replica-1 psql -U editor -d texteditor -c "SELECT * FROM users WHERE email='replication@test.com';"
```

**Expected**: Data appears on replica

### Test 7: Redis Cluster

**Check Cluster Status**:

```bash
docker exec -it redis-node-1 redis-cli -p 7001 cluster info
docker exec -it redis-node-1 redis-cli -p 7001 cluster nodes
```

**Expected**: 
- `cluster_state:ok`
- 6 nodes (3 masters, 3 replicas)

**Test Data Distribution**:

```bash
# Set keys - they'll be distributed across masters
docker exec -it redis-node-1 redis-cli -p 7001 -c set key1 "value1"
docker exec -it redis-node-1 redis-cli -p 7001 -c set key2 "value2"
docker exec -it redis-node-1 redis-cli -p 7001 -c set key3 "value3"

# Get keys
docker exec -it redis-node-1 redis-cli -p 7001 -c get key1
```

**Expected**: Keys distributed across different nodes based on hash slots

### Test 8: Kafka Event Streaming

**Check Kafka Topics**:

```bash
docker exec -it kafka-1 kafka-topics --bootstrap-server localhost:9092 --list
```

**Expected**: Topics like `document-events`, `collaboration-events`

**Produce Test Event**:

```bash
docker exec -it kafka-1 kafka-console-producer --bootstrap-server localhost:9092 --topic document-events
# Type a message and press Enter
# Press Ctrl+C to exit
```

**Consume Events**:

```bash
docker exec -it kafka-1 kafka-console-consumer --bootstrap-server localhost:9092 --topic document-events --from-beginning
```

**Expected**: See the message you produced

### Test 9: Fault Tolerance - Service Failure

**Simulate Auth Service Failure**:

```bash
# Stop one auth service
docker stop auth-service-1

# Try to login - should still work via auth-service-2
curl -X POST http://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123!@#"}'

# Restart the service
docker start auth-service-1
```

**Expected**: 
- ✅ Login still works
- ✅ No errors for users

### Test 10: Fault Tolerance - Redis Node Failure

**Simulate Redis Master Failure**:

```bash
# Stop a Redis master
docker stop redis-node-1

# Check cluster status - replica should be promoted
docker exec -it redis-node-2 redis-cli -p 7002 cluster nodes

# Try to set/get data - should still work
docker exec -it redis-node-2 redis-cli -p 7002 -c set test "failover-test"
docker exec -it redis-node-2 redis-cli -p 7002 -c get test

# Restart the node
docker start redis-node-1
```

**Expected**: 
- ✅ Cluster continues operating
- ✅ Replica promoted to master
- ✅ Data accessible

### Test 11: Fault Tolerance - Database Replica Failure

```bash
# Stop a replica
docker stop postgres-replica-1

# Application should still work (writes to master)
# Check replication status
docker exec -it postgres-master psql -U editor -d texteditor -c "SELECT * FROM pg_stat_replication;"

# Restart replica
docker start postgres-replica-1
```

**Expected**: 
- ✅ Application continues working
- ✅ Only 1 replica shown in replication status
- ✅ Replica catches up when restarted

---

## 4. Performance Tests

### Test 12: Caching Performance

**Without Cache**:

```bash
# Clear Redis cache
docker exec -it redis-node-1 redis-cli -p 7001 -c FLUSHALL

# Time a document request
time curl http://localhost/api/documents/1 -H "Authorization: Bearer YOUR_TOKEN"
```

**With Cache**:

```bash
# Request same document again (should be cached)
time curl http://localhost/api/documents/1 -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected**: Second request significantly faster

### Test 13: Concurrent Users

**Use Apache Bench** (if installed):

```bash
# 100 requests, 10 concurrent
ab -n 100 -c 10 http://localhost/health
```

**Expected**: 
- ✅ All requests successful
- ✅ Requests distributed across instances

### Test 14: WebSocket Scalability

**Open Multiple Browser Tabs**:
1. Open 5-10 tabs with http://localhost:3000
2. Login to each
3. Open the same document in all tabs
4. Type in one tab

**Expected**: 
- ✅ All tabs receive updates
- ✅ No lag or delays
- ✅ Different tabs may connect to different collaboration service instances

---

## 5. Monitoring & Observability

### Check Logs

```bash
# View all logs
docker-compose -f docker-compose.distributed.yml logs -f

# View specific service logs
docker-compose -f docker-compose.distributed.yml logs -f auth-service-1

# View last 50 lines
docker-compose -f docker-compose.distributed.yml logs --tail=50 auth-service-1
```

### Access Management UIs

**Kafka UI**: http://localhost:8080
- View topics
- Monitor consumer groups
- Check message throughput

**pgAdmin**: http://localhost:5050
- Login: admin@admin.com / admin
- View database tables
- Run queries

**Redis Commander**: http://localhost:8081
- View keys
- Monitor cluster status
- Check memory usage

---

## 6. API Testing with Swagger

### Auth Service API Docs
http://localhost:3001/api-docs

**Test Endpoints**:
- POST /register
- POST /login
- GET /profile
- POST /refresh-token

### Document Service API Docs
http://localhost:3002/api-docs

**Test Endpoints**:
- POST /documents
- GET /documents
- GET /documents/:id
- PUT /documents/:id
- DELETE /documents/:id

---

## 7. Quick Test Script

Save this as `test-system.sh`:

```bash
#!/bin/bash

echo "🧪 Testing Distributed System..."
echo ""

echo "1️⃣ Checking Service Health..."
curl -s http://localhost/health | jq .
curl -s http://localhost:3001/health | jq .
curl -s http://localhost:3002/health | jq .
echo ""

echo "2️⃣ Checking Redis Cluster..."
docker exec redis-node-1 redis-cli -p 7001 cluster info | grep cluster_state
echo ""

echo "3️⃣ Checking PostgreSQL Replication..."
docker exec postgres-master psql -U editor -d texteditor -c "SELECT count(*) FROM pg_stat_replication;" -t
echo "replicas connected"
echo ""

echo "4️⃣ Checking Kafka Brokers..."
docker exec kafka-1 kafka-broker-api-versions --bootstrap-server localhost:9092 | grep "ApiVersion" | wc -l
echo "API versions available"
echo ""

echo "5️⃣ Checking Container Status..."
docker-compose -f docker-compose.distributed.yml ps | grep "Up" | wc -l
echo "containers running"
echo ""

echo "✅ System Health Check Complete!"
```

Run with: `bash test-system.sh`

---

## 8. Expected Results Summary

| Test | Expected Result | Verifies |
|------|----------------|----------|
| Health Checks | All services return 200 OK | Service availability |
| User Registration | Account created, email sent | Auth service working |
| Login | JWT tokens returned | Authentication working |
| Document CRUD | Documents created/updated | Document service working |
| Real-time Editing | Changes appear instantly | WebSocket + Redis pub/sub |
| Load Balancing | Requests distributed | Nginx + Gateway working |
| DB Replication | Data appears on replicas | PostgreSQL replication |
| Redis Cluster | 6 nodes, cluster_state:ok | Redis clustering |
| Kafka Events | Messages produced/consumed | Event streaming |
| Service Failure | System continues operating | Fault tolerance |
| Redis Failover | Replica promoted | High availability |
| Caching | Faster subsequent requests | Redis caching |

---

## 🎓 Demonstrating Distributed Systems Concepts

When presenting this project, highlight:

1. **Horizontal Scalability**: Show multiple instances handling requests
2. **Fault Tolerance**: Stop a service, show system continues
3. **Data Replication**: Show data on master appears on replicas
4. **Load Balancing**: Show requests distributed across instances
5. **Event-Driven Architecture**: Show Kafka events flowing
6. **Distributed Caching**: Show Redis cluster distributing data
7. **Real-time Sync**: Show multiple users editing simultaneously

---

## 🐛 Troubleshooting

**If services aren't starting**:
```bash
docker-compose -f docker-compose.distributed.yml logs [service-name]
```

**If Redis cluster isn't forming**:
```bash
docker-compose -f docker-compose.distributed.yml restart redis-cluster-init
```

**If PostgreSQL replicas aren't replicating**:
```bash
docker-compose -f docker-compose.distributed.yml restart postgres-replica-1 postgres-replica-2
```

**If Kafka isn't working**:
```bash
docker-compose -f docker-compose.distributed.yml restart zookeeper kafka-1 kafka-2 kafka-3
```

---

## ✅ Test Completion Checklist

- [ ] All 28 containers running
- [ ] Health endpoints responding
- [ ] User can register and login
- [ ] Documents can be created
- [ ] Real-time collaboration works
- [ ] Load balancing verified
- [ ] Database replication working
- [ ] Redis cluster healthy
- [ ] Kafka events flowing
- [ ] Service failure handled gracefully
- [ ] Monitoring UIs accessible

**Your distributed system is fully operational when all checkboxes are ✅!**
