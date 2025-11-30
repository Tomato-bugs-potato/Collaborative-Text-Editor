# Microservices Architecture

This distributed text editor has been restructured into a microservices architecture for better scalability, maintainability, and fault isolation.

## 🏗️ Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐
│   React Client  │◄──►│   API Gateway   │
│   (Port 3000)   │    │   (Port 4000)   │
└─────────────────┘    └─────────────────┘
                              │
               ┌──────────────┼──────────────┐
               │              │              │
        ┌──────▼─────┐ ┌──────▼─────┐ ┌──────▼─────┐
        │ Auth       │ │ Document   │ │ Collaboration│
        │ Service    │ │ Service    │ │ Service     │
        │ (Port 3001)│ │ (Port 3002)│ │ (Port 3003) │
        └────────────┘ └────────────┘ └────────────┘
               │              │              │
               └──────────────┼──────────────┘
                              │
                   ┌──────────▼──────────┐
                   │  Shared Database    │
                   │  PostgreSQL + Redis │
                   │  (Ports 5432, 6379) │
                   └─────────────────────┘
```

## 📁 Service Responsibilities

### **API Gateway (Port 4000)**
- **Purpose**: Single entry point for all client requests
- **Responsibilities**:
  - Route requests to appropriate microservices
  - Handle authentication middleware
  - Load balancing
  - Request/response transformation
  - Rate limiting

### **Auth Service (Port 3001)**
- **Purpose**: User authentication and authorization
- **Responsibilities**:
  - User registration/login
  - JWT token generation/validation
  - Session management
  - Password hashing

### **Document Service (Port 3002)**
- **Purpose**: Document CRUD operations
- **Responsibilities**:
  - Create, read, update, delete documents
  - Document metadata management
  - Access control (who can edit what)
  - Document versioning

### **Collaboration Service (Port 3003)**
- **Purpose**: Real-time collaborative editing
- **Responsibilities**:
  - WebSocket connections for real-time updates
  - Operational Transformation (OT) algorithm
  - Conflict resolution
  - Broadcasting changes to connected clients
  - Redis pub/sub for cross-server communication

## 🔄 Service Communication

### **Synchronous Communication**
- **API Gateway → Services**: HTTP REST API calls
- **Services → Database**: Direct database connections

### **Asynchronous Communication**
- **Collaboration Service**: WebSocket connections with clients
- **Cross-Service**: Redis pub/sub channels for distributed events

## 🚀 Running the Microservices

### **Option 1: Docker Compose (Recommended)**
```bash
# Start all services
docker-compose -f docker-compose.microservices.yml up -d

# Include management tools
docker-compose -f docker-compose.microservices.yml --profile tools up -d
```

### **Option 2: Individual Development**
```bash
# Start infrastructure
docker-compose up -d postgres redis

# Start each service individually
cd services/auth-service && npm install && npm run dev
cd services/document-service && npm install && npm run dev
cd services/collaboration-service && npm install && npm run dev
cd services/api-gateway && npm install && npm run dev
cd client && npm install && npm start
```

## 📊 Service Endpoints

### **API Gateway Routes**
```
POST   /api/auth/login          → Auth Service
POST   /api/auth/register       → Auth Service
GET    /api/documents          → Document Service
POST   /api/documents          → Document Service
GET    /api/documents/:id      → Document Service
PUT    /api/documents/:id      → Document Service
WS     /socket.io/             → Collaboration Service
```

### **Direct Service Ports** (for development)
- **Auth**: http://localhost:3001
- **Document**: http://localhost:3002
- **Collaboration**: http://localhost:3003
- **API Gateway**: http://localhost:4000

## 🗄️ Shared Resources

### **Database Schema**
All services share the same PostgreSQL database with different tables:

- **auth-service**: `users`, `sessions`
- **document-service**: `documents`, `permissions`
- **collaboration-service**: Uses Redis for pub/sub, PostgreSQL for persistence

### **Shared Utilities**
Common functions in `shared/utils/`:
- ID generation
- Input validation
- Response formatting
- Error handling

## 🔧 Development Workflow

### **Adding a New Feature**
1. Identify which service should handle it
2. Update the service's code
3. Update API Gateway routes if needed
4. Test inter-service communication
5. Update shared utilities if needed

### **Database Changes**
1. Modify Prisma schema in the relevant service
2. Run migrations: `npx prisma db push`
3. Update other services if schema changes affect them

### **Adding a New Service**
1. Create new directory under `services/`
2. Add package.json with dependencies
3. Add to docker-compose.microservices.yml
4. Update API Gateway routing
5. Update shared utilities if needed

## 🔍 Monitoring & Debugging

### **Logs**
```bash
# View all service logs
docker-compose -f docker-compose.microservices.yml logs -f

# View specific service logs
docker-compose -f docker-compose.microservices.yml logs auth-service
```

### **Health Checks**
Each service exposes health endpoints:
- `GET /health` - Service health status
- `GET /metrics` - Prometheus metrics (future)

### **Database Access**
- **pgAdmin**: http://localhost:5050
- **Redis Commander**: http://localhost:8081
- **Prisma Studio**: `npx prisma studio`

## 🚀 Benefits of Microservices Architecture

1. **Scalability**: Scale individual services based on load
2. **Fault Isolation**: One service failure doesn't bring down others
3. **Technology Diversity**: Use different tech stacks per service
4. **Team Autonomy**: Teams can work on different services independently
5. **Deployment Flexibility**: Deploy services independently
6. **Easier Testing**: Test services in isolation

## 🔐 Security Considerations

- **API Gateway**: Handles authentication and authorization
- **Service-to-Service**: Use JWT tokens or API keys
- **Database**: Separate credentials per service
- **Network**: Services communicate over internal Docker network

This microservices architecture provides a solid foundation for scaling your distributed text editor to handle thousands of concurrent users while maintaining high availability and fault tolerance.
