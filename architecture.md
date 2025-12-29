# 🏗️ Distributed Collaborative Text Editor: Technical Architecture Deep-Dive

This document provides an exhaustive, bit-by-bit technical breakdown of the system's architecture. It focuses on the internal logic, data structures, and distributed coordination mechanisms that enable real-time, consistent collaboration at scale.

---

## 1. 🤝 Collaboration Service: Internal Logic & Data Flow

The Collaboration Service is the entry point for all real-time user interactions. It manages stateful WebSocket connections and coordinates with Redis and Kafka.

### 🧩 Internal Components & State
- **`otBuffer`**: An in-memory array that temporarily stores `OperationalTransform` records before they are flushed to the database.
- **`Socket.io Server`**: Handles the WebSocket lifecycle (connection, authentication, rooms).
- **`Redis Adapter`**: Synchronizes events across multiple service instances using a Redis Cluster.

### 🔄 Service Internal Logic Diagram
```mermaid
graph TD
    subgraph "WebSocket Handler"
        WS[WebSocket Connection] --> Auth{JWT Auth}
        Auth -- Success --> Join[Join Document Room]
        Auth -- Fail --> Disc[Disconnect]
    end

    subgraph "Event Processing"
        Join --> Changes[Receive 'send-changes']
        Changes --> Buffer[Add to otBuffer]
        Changes --> Broadcast[Broadcast to Room via Redis]
        Changes --> Kafka[Publish to 'document-changes']
    end

    subgraph "Batch Writing Loop (Every 2s)"
        Timer[Interval Timer] --> Check{otBuffer > 0?}
        Check -- Yes --> Flush[prisma.createMany]
        Flush --> Clear[Clear otBuffer]
    end

    subgraph "Kafka Consumer"
        KSub[Subscribe: 'document-updates'] --> KProc[Process Sync Ack]
        KProc --> KEmit[Emit 'document-synced' to Client]
    end
```

---

## 2. ⚖️ Reconciliation Service: The OT Engine

The Reconciliation Service is the "Source of Truth" for document consistency. It ensures that concurrent edits from different users are merged correctly.

### 🧩 Internal Components & State
- **`operationBuffers` (Map)**: A key-value store where the key is `documentId` and the value is a buffer object containing:
    - `operations`: The last 100 reconciled operations (for transformation history).
    - `currentContent`: The full, reconciled text of the document.
    - `serverVersion`: The latest version number.
    - `isDirty`: A flag indicating if the buffer needs flushing to the DB.

### ⚙️ OT Reconciliation Logic Diagram
```mermaid
graph TD
    subgraph "Kafka Consumer Handler"
        KMsg[Receive 'document-changes'] --> Parse[Parse Operation & Version]
        Parse --> GetBuffer[Get/Fetch Document Buffer]
    end

    subgraph "OT Transformation Loop"
        GetBuffer --> Filter[Filter Concurrent Ops > Client Version]
        Filter --> Transform[ot.transformOperation Loop]
        Transform --> Apply[ot.applyOperation to currentContent]
    end

    subgraph "State Update & Ack"
        Apply --> IncVer[Increment serverVersion]
        IncVer --> MarkDirty[Set isDirty = true]
        MarkDirty --> Ack[Publish to 'document-updates']
    end

    subgraph "Write-Back Loop (Every 2s)"
        WTimer[Interval Timer] --> WCheck{isDirty == true?}
        WCheck -- Yes --> DBUpdate[prisma.document.update]
        DBUpdate --> Snap[Publish to 'document-snapshots']
        Snap --> ResetDirty[Set isDirty = false]
    end
```

---

## 3. 📦 Storage Service: Snapshot & Persistence

The Storage Service handles long-term persistence and point-in-time recovery.

### 🧩 Internal Logic
- **Kafka Consumer**: Subscribes to the `document-snapshots` topic.
- **MinIO Client**: Uploads document states as JSON blobs.

### 🔄 Snapshot Flow Diagram
```mermaid
graph LR
    subgraph "Kafka Consumer"
        KMsg[document-snapshots] --> JSON[Parse JSON Payload]
    end

    subgraph "Storage Logic"
        JSON --> Path[Generate Key: snapshots/docId/version.json]
        Path --> MinIO[s3.upload to MinIO]
    end

    subgraph "REST API"
        Req[GET /snapshots/:filename] --> Sign[Generate Signed URL]
        Sign --> Redirect[302 Redirect to MinIO]
    end
```

---

## 4. 🧬 Life of an Edit: Bit-by-Bit Sequence

This diagram shows the exact path a single character takes through the distributed system.

```mermaid
sequenceDiagram
    autonumber
    participant C as ⚛️ Client
    participant CS as 🤝 Collab Service
    participant R as 🔴 Redis Cluster
    participant K as 🌉 Kafka Cluster
    participant RS as ⚖️ Recon Service
    participant DB as 🐘 PostgreSQL
    participant SS as 📦 Storage Service
    participant M as ☁️ MinIO

    Note over C,CS: 1. User types 'A'
    C->>CS: socket.emit('send-changes', {op: 'A', ver: 10})
    
    Note over CS,R: 2. Optimistic Sync
    CS->>R: Publish to Redis (Room Sync)
    R-->>CS: Notify other instances
    CS-->>C: Broadcast to other clients
    
    Note over CS,K: 3. Persistence Pipeline
    CS->>CS: Push to otBuffer (Batching)
    CS->>K: Publish to 'document-changes'
    
    Note over K,RS: 4. Reconciliation
    K->>RS: Consume 'document-changes'
    RS->>RS: Perform OT Transformation
    RS->>RS: Update In-Memory Buffer
    RS->>K: Publish 'document-updates' (Ack)
    
    Note over RS,DB: 5. Write-Back (Async)
    RS->>DB: prisma.document.update (Every 2s)
    RS->>K: Publish 'document-snapshots'
    
    Note over K,SS: 6. Long-term Storage
    K->>SS: Consume 'document-snapshots'
    SS->>M: Upload to MinIO
    
    Note over CS,C: 7. Final Sync
    K->>CS: Consume 'document-updates'
    CS->>C: socket.emit('document-synced', {ver: 11})
```

---

## 5. 👤 Presence & Cursor Sub-Architecture

Presence is handled via a dedicated service to keep the Collaboration Service lightweight.

### 🧩 Presence Logic Diagram
```mermaid
graph TD
    subgraph "Presence Service (In-Memory)"
        Store[(Presence Map: docId -> users)]
    end

    subgraph "Collaboration Service Integration"
        CJoin[User Joins] --> PPost[POST /presence/docId/userId]
        CMove[Cursor Moves] --> PUpdate[POST /presence/docId/userId]
        PPost --> Store
        PUpdate --> Store
        CJoin --> PGet[GET /presence/docId]
        PGet --> Store
    end

    subgraph "Client Updates"
        PUpdate --> CBroadcast[Broadcast 'cursor-update' to Room]
    end
```

---

## 6. 🛠️ Infrastructure: The Distributed Stack

The system is designed to be resilient and observable.

### ☸️ Kubernetes Cluster Architecture
- **StatefulSets**:
    - **Kafka**: Single-node broker (expandable) for event streaming.
    - **Redis Cluster**: 6-node cluster (3 Master, 3 Replica) for high availability and pub/sub.
    - **PostgreSQL**: Master-Replica architecture (`postgres-master`, `postgres-replica`) for data durability and read scaling.
- **Deployments**:
    - **Microservices**: Stateless deployments for `auth`, `collaboration`, `document`, `presence`, `storage`, and `reconciliation` services.
    - **API Gateway**: Central entry point for routing requests.
    - **Client**: React frontend served via Nginx.
- **Networking**:
    - **Nginx Load Balancer**: Layer 7 Ingress/LoadBalancer exposing the application to the outside world.
    - **Headless Services**: For stable network identities of stateful pods.

### 📊 Monitoring Pipeline
```mermaid
graph LR
    Services[Microservices] -- "/metrics" --> Prom[Prometheus]
    Kafka[Kafka Exporter] --> Prom
    Redis[Redis Exporter] --> Prom
    Prom --> Grafana[Grafana Dashboards]
```

---

*This architecture ensures that even if a database write is delayed (via batching), the user experience remains real-time and consistent across all distributed nodes.*
