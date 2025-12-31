# Build all services
docker build -t api-gateway:latest -f ./services/api-gateway/Dockerfile ./services
docker build -t auth-service:latest -f ./services/auth-service/Dockerfile ./services
docker build -t document-service:latest -f ./services/document-service/Dockerfile ./services
docker build -t collaboration-service:latest -f ./services/collaboration-service/Dockerfile ./services
docker build -t presence-service:latest -f ./services/presence-service/Dockerfile ./services
docker build -t storage-service:latest -f ./services/storage-service/Dockerfile ./services
docker build -t reconciliation-service:latest -f ./services/reconciliation-service/Dockerfile ./services
docker build -t failover-service:latest -f ./services/failover-service/Dockerfile ./services
docker build -t testing-dashboard:latest -f ./services/testing-dashboard/Dockerfile ./services/testing-dashboard
# docker build -t client:latest ./client
