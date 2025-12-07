# Multi-User Distributed Text Editor
## Complete Technical Documentation

---

## 1. Executive Summary

A **production-grade real-time collaborative text editor** built on a **microservices architecture** implementing core distributed systems principles. The system enables multiple users to simultaneously edit documents with live synchronization, leveraging **27 containerized services** for horizontal scalability, fault tolerance, and high availability.

---

## 2. Complete Infrastructure Overview

### Container Count by Category

| Category | Count | Components |
|----------|-------|------------|
| **Database** | 3 | PostgreSQL Master + 2 Replicas |
| **Kafka Cluster** | 4 | 3 Brokers + Zookeeper |
| **Redis Cluster** | 7 | 6 Data Nodes + 1 Init Container |
| **API Gateways** | 2 | Gateway 1 + Gateway 2 |
| **Auth Services** | 2 | Auth 1 + Auth 2 |
| **Document Services** | 2 | Doc 1 + Doc 2 |
| **Collaboration Services** | 3 | Collab 1 + Collab 2 + Collab 3 |
| **Reconciliation Services** | 2 | Reconcile 1 + Reconcile 2 |
| **Load Balancer** | 1 | Nginx |
| **Client** | 1 | React Frontend |
| **Monitoring Tools** | 3 | Kafka UI, PgAdmin, Redis Commander |
| **Total** | **30** | **Full Distributed Stack** |

---

## 3. Architecture Diagram

```mermaid
graph TB
    subgraph "Client Layer"
        C[React Client + Quill.js<br/>:3000]
    end
    
    subgraph "Load Balancing Layer"
        N[Nginx Load Balancer<br/>:80/:443]
    end
    
    subgraph "API Gateway Layer - 2 Instances"
        AG1[API Gateway 1<br/>:4000]
        AG2[API Gateway 2<br/>:4001]
    end
    
    subgraph "Auth Service Layer - 2 Instances"
        AS1[Auth Service 1<br/>:3001]
        AS2[Auth Service 2<br/>:3011]
    end
    
    subgraph "Document Service Layer - 2 Instances"
        DS1[Document Service 1<br/>:3002]
        DS2[Document Service 2<br/>:3012]
    end
    
    subgraph "Collaboration Service Layer - 3 Instances"
        CS1[Collaboration 1<br/>:3003]
        CS2[Collaboration 2<br/>:3013]
        CS3[Collaboration 3<br/>:3023]
    end
    
    subgraph "Reconciliation Layer - 2 Instances"
        RS1[Reconcile 1]
        RS2[Reconcile 2]
    end
    
    subgraph "PostgreSQL Cluster - Master + 2 Replicas"
        PGM[(Master<br/>:5432)]
        PGR1[(Replica 1<br/>:5433)]
        PGR2[(Replica 2<br/>:5434)]
    end
    
    subgraph "Redis Cluster - 6 Nodes (3 Masters + 3 Replicas)"
        R1[Node 1<br/>:7001]
        R2[Node 2<br/>:7002]
        R3[Node 3<br/>:7003]
        R4[Node 4<br/>:7004]
        R5[Node 5<br/>:7005]
        R6[Node 6<br/>:7006]
    end
    
    subgraph "Kafka Cluster - 3 Brokers"
        ZK[Zookeeper<br/>:2181]
        K1[Broker 1<br/>:9092]
        K2[Broker 2<br/>:9093]
        K3[Broker 3<br/>:9094]
    end
    
    C --> N
    N --> AG1 & AG2
    AG1 & AG2 --> AS1 & AS2
    AG1 & AG2 --> DS1 & DS2
    AG1 & AG2 --> CS1 & CS2 & CS3
    
    AS1 & AS2 --> PGM
    DS1 & DS2 --> PGM
    DS1 & DS2 --> R1 & R2 & R3
    DS1 & DS2 --> K1 & K2 & K3
    
    CS1 & CS2 & CS3 --> PGM
    CS1 & CS2 & CS3 --> R1 & R2 & R3
    CS1 & CS2 & CS3 --> K1 & K2 & K3
    
    RS1 & RS2 --> K1 & K2 & K3
    
    PGM -.->|Streaming Replication| PGR1 & PGR2
    K1 & K2 & K3 --> ZK
    R1 -.-> R4
    R2 -.-> R5
    R3 -.-> R6
```

---

## 4. Distributed System Capabilities - Deep Dive

### 4.1 Horizontal Scaling (Stateless Microservices)

| Service | Instances | Scaling Strategy |
|---------|-----------|------------------|
| API Gateway | 2 | Stateless, round-robin via Nginx |
| Auth Service | 2 | Stateless, JWT-based (no session state) |
| Document Service | 2 | Stateless + Redis cache |
| Collaboration Service | 3 | Redis Adapter for cross-instance pub/sub |
| Reconciliation Service | 2 | Kafka consumer group (partitioned) |

**How it works:**
- Each service instance is identical and interchangeable
- Nginx distributes incoming traffic across all gateway instances
- API Gateway further distributes to service instances using round-robin
- No sticky sessions required (except WebSocket - handled by Redis Adapter)

---

### 4.2 Database Replication (PostgreSQL)

```mermaid
graph LR
    subgraph "Write Path"
        A[Application] -->|INSERT/UPDATE/DELETE| M[(Master :5432)]
    end
    
    subgraph "Streaming Replication"
        M -->|WAL Stream| R1[(Replica 1 :5433)]
        M -->|WAL Stream| R2[(Replica 2 :5434)]
    end
    
    subgraph "Read Path (Future)"
        A -.->|SELECT| R1
        A -.->|SELECT| R2
    end
```

**Configuration:**
- **Master (postgres-master:5432):** Handles all write operations
- **Replica 1 (postgres-replica-1:5433):** Streaming replication, read-only
- **Replica 2 (postgres-replica-2:5434):** Streaming replication, read-only
- **Replication Mode:** Asynchronous streaming (low latency, eventual consistency)

**Benefits:**
- **High Availability:** If master fails, a replica can be promoted
- **Read Scaling:** Read queries can be distributed to replicas (configurable via env vars `DB_REPLICA_1`, `DB_REPLICA_2`)
- **Disaster Recovery:** Replicas provide point-in-time recovery capability

---

### 4.3 Distributed Caching (Redis Cluster)

```mermaid
graph TB
    subgraph "Redis Cluster - 6 Nodes"
        subgraph "Master Nodes (Data Sharding)"
            M1[Master 1<br/>:7001<br/>Slots 0-5460]
            M2[Master 2<br/>:7002<br/>Slots 5461-10922]
            M3[Master 3<br/>:7003<br/>Slots 10923-16383]
        end
        subgraph "Replica Nodes (Failover)"
            S1[Replica 4<br/>:7004]
            S2[Replica 5<br/>:7005]
            S3[Replica 6<br/>:7006]
        end
        M1 -.->|Replicates to| S1
        M2 -.->|Replicates to| S2
        M3 -.->|Replicates to| S3
    end
```

**Configuration:**
- **6 Nodes Total:** 3 Masters + 3 Replicas
- **Hash Slots:** 16,384 slots divided among 3 masters
- **Replication Factor:** 1 (each master has 1 replica)
- **Cluster Mode:** Enabled with automatic failover

**Use Cases:**
1. **Document Caching:** Hot documents cached to reduce database load
2. **Socket.IO Adapter:** Cross-instance WebSocket message broadcasting
3. **Session State:** Collaboration session data shared across instances

---

### 4.4 Message Queue (Apache Kafka)

```mermaid
graph TB
    subgraph "Kafka Cluster"
        ZK[Zookeeper<br/>Cluster Coordination]
        
        subgraph "Brokers"
            B1[Broker 1<br/>ID: 1<br/>:9092]
            B2[Broker 2<br/>ID: 2<br/>:9093]
            B3[Broker 3<br/>ID: 3<br/>:9094]
        end
        
        ZK --> B1 & B2 & B3
    end
    
    subgraph "Topics"
        T1[document-changes<br/>Replication: 3]
        T2[document-events<br/>Replication: 3]
    end
    
    subgraph "Producers"
        DS[Document Service]
        CS[Collaboration Service]
    end
    
    subgraph "Consumers"
        RS[Reconciliation Service<br/>Consumer Group]
    end
    
    DS -->|Lifecycle Events| T2
    CS -->|OT Operations| T1
    T1 & T2 --> RS
```

**Configuration:**
- **3 Brokers:** kafka-1, kafka-2, kafka-3
- **Replication Factor:** 3 (topics replicated across all brokers)
- **Min In-Sync Replicas:** 1 (at least 1 replica must acknowledge)
- **Consumer Groups:** Reconciliation services share a consumer group for partition distribution

**Topics:**
| Topic | Producer | Purpose |
|-------|----------|---------|
| `document-changes` | Collaboration Service | Real-time OT operations |
| `document-events` | Document Service | Lifecycle events (create, update, delete) |

---

### 4.5 Load Balancing (Multi-Layer)

```mermaid
graph LR
    subgraph "Layer 1: Nginx (L7)"
        N[Nginx<br/>:80/:443]
    end
    
    subgraph "Layer 2: API Gateway (Application)"
        AG1[Gateway 1]
        AG2[Gateway 2]
    end
    
    subgraph "Layer 3: Service Discovery (Docker DNS)"
        S1[auth-service-1]
        S2[auth-service-2]
        S3[document-service-1]
        S4[document-service-2]
    end
    
    N -->|Round Robin| AG1
    N -->|Round Robin| AG2
    AG1 -->|Round Robin| S1 & S2 & S3 & S4
    AG2 -->|Round Robin| S1 & S2 & S3 & S4
```

**Nginx Configuration:**
- Distributes traffic to API Gateway instances
- Health-check based routing (unhealthy instances excluded)
- WebSocket upgrade support for collaboration

**API Gateway Load Balancing:**
- Maintains list of service URLs from environment variables
- Round-robin selection across service instances
- Single point of entry for all client requests

---

### 4.6 Real-Time Collaboration (Socket.IO + Redis)

```mermaid
sequenceDiagram
    participant U1 as User 1 (Browser)
    participant CS1 as Collab Service 1
    participant R as Redis Adapter
    participant CS2 as Collab Service 2
    participant U2 as User 2 (Browser)
    
    U1->>CS1: connect()
    U1->>CS1: join-document(docId)
    CS1->>R: Subscribe to doc room
    
    U2->>CS2: connect()
    U2->>CS2: join-document(docId)
    CS2->>R: Subscribe to doc room
    
    U1->>CS1: send-changes(delta)
    CS1->>R: Publish to doc room
    R->>CS2: Forward message
    CS2->>U2: receive-changes(delta)
    
    Note over U1,U2: Changes appear in real-time<br/>across different service instances
```

**Cross-Instance Communication:**
- Socket.IO uses Redis Adapter for pub/sub
- User 1 connected to Collab Service 1
- User 2 connected to Collab Service 2
- Both users see each other's changes instantly

---

### 4.7 Event-Driven Architecture

```mermaid
graph LR
    subgraph "Producers"
        DS[Document Service]
        CS[Collaboration Service]
    end
    
    subgraph "Kafka"
        K((Kafka Cluster))
    end
    
    subgraph "Consumers"
        RS1[Reconciliation 1]
        RS2[Reconciliation 2]
    end
    
    DS -->|DOCUMENT_CREATED<br/>DOCUMENT_UPDATED<br/>DOCUMENT_DELETED| K
    CS -->|OT Operations| K
    K -->|Partition 0| RS1
    K -->|Partition 1| RS2
```

**Event Types:**
- `DOCUMENT_CREATED`: New document created
- `DOCUMENT_UPDATED`: Document content/title changed
- `DOCUMENT_DELETED`: Document removed
- `COLLABORATOR_ADDED/REMOVED`: Sharing changes

---

## 5. Fault Tolerance & High Availability

| Component | Failure Scenario | Handling Mechanism |
|-----------|------------------|-------------------|
| **Auth Service** | 1 of 2 instances fails | Nginx routes to healthy instance |
| **Document Service** | 1 of 2 instances fails | Gateway routes to healthy instance |
| **Collaboration Service** | 1 of 3 fails | User reconnects to another instance via Redis Adapter |
| **Reconciliation Service** | 1 of 2 fails | Kafka rebalances partitions to remaining consumer |
| **PostgreSQL Master** | Master fails | Manual failover to replica (or use Patroni) |
| **PostgreSQL Replica** | Replica fails | No impact (read queries can use other replica) |
| **Redis Node** | Master node fails | Cluster promotes replica automatically |
| **Kafka Broker** | 1 of 3 brokers fails | Other brokers continue (replication factor 3) |
| **Nginx** | Nginx fails | Single point of failure (add keepalived for HA) |

---

## 6. What's Implemented vs. What's Missing

### ✅ Implemented Capabilities

| Capability | Implementation Details |
|------------|------------------------|
| **Microservices Architecture** | 5 independent services with clear boundaries |
| **Horizontal Scaling** | Multiple instances of each service |
| **Database Replication** | PostgreSQL master + 2 streaming replicas |
| **Distributed Caching** | Redis Cluster (6 nodes, 3 masters + 3 replicas) |
| **Message Queue** | Kafka Cluster (3 brokers + Zookeeper) |
| **Real-time Sync** | Socket.IO with Redis Adapter |
| **Load Balancing** | Nginx (L7) + API Gateway (application) |
| **Service Discovery** | Docker DNS-based discovery |
| **Health Checks** | All services have Docker healthchecks |
| **API Documentation** | Swagger UI for Auth and Document services |
| **Containerization** | Full Docker Compose orchestration |
| **Monitoring Tools** | Kafka UI, PgAdmin, Redis Commander |

### ⚠️ Limitations & Missing Features

| Missing Feature | Impact | Recommended Solution |
|-----------------|--------|---------------------|
| **True CRDT/OT** | Last-write-wins for concurrent edits | Implement Yjs or Automerge |
| **Read-Replica Routing** | Replicas not used for reads | Implement read/write splitting |
| **Circuit Breakers** | Cascading failures possible | Add Resilience4j or Polly |
| **Distributed Tracing** | Hard to debug cross-service issues | Add Jaeger or Zipkin |
| **Centralized Logging** | Logs scattered across containers | Add ELK Stack or Loki |
| **Auto-Scaling** | Manual scaling only | Migrate to Kubernetes with HPA |
| **Service Mesh** | Limited observability | Add Istio or Linkerd |
| **OAuth/SSO** | Basic email/password auth only | Add Keycloak or Auth0 |
| **Rate Limiting** | No request throttling | Add rate limiting middleware |
| **Database Failover** | Manual replica promotion | Add Patroni or PgPool-II |

---

## 7. Technology Stack Summary

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Frontend** | React, Quill.js | Rich text editing |
| **Real-time** | Socket.IO | WebSocket communication |
| **API Gateway** | Express.js + http-proxy-middleware | Request routing, load balancing |
| **Services** | Node.js, Express.js | REST APIs |
| **ORM** | Prisma | Database access |
| **Database** | PostgreSQL 15 | Primary data store |
| **Caching** | Redis 7 (Cluster) | Document caching, pub/sub |
| **Messaging** | Apache Kafka 7.5 | Event streaming |
| **Coordination** | Zookeeper | Kafka cluster management |
| **Load Balancer** | Nginx | Traffic distribution |
| **Container Runtime** | Docker | Service isolation |
| **Orchestration** | Docker Compose | Multi-container deployment |
| **API Docs** | Swagger/OpenAPI | Interactive API documentation |

---

## 8. Conclusion

This project demonstrates a **comprehensive distributed system** with:

- **27-30 containerized services** working in concert
- **True horizontal scaling** with multiple instances per service
- **Data redundancy** through PostgreSQL replication and Redis clustering
- **Async messaging** with a 3-broker Kafka cluster
- **Real-time collaboration** via Socket.IO with Redis Adapter
- **Multi-layer load balancing** (Nginx → API Gateway → Services)

The architecture is **production-ready** for moderate scale and provides a solid foundation for enterprise deployment with the recommended enhancements.
