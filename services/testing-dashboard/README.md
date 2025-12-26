# Testing Dashboard Service - Deployment Guide

## Overview
The Testing Dashboard is now a **microservice** that runs alongside your other services in Kubernetes. It provides real-time monitoring of your distributed system.

## Quick Deploy

### 1. Build the Docker Image
```powershell
# Build all images (includes testing-dashboard)
.\build-images.ps1

# Or build just the dashboard:
docker build -t testing-dashboard:latest -f ./services/testing-dashboard/Dockerfile ./services/testing-dashboard
```

### 2. Deploy to Kubernetes
```bash
# Deploy the dashboard service
kubectl apply -f k8s/services/testing-dashboard.yaml

# Verify it's running
kubectl get pods -l app=testing-dashboard
kubectl get svc testing-dashboard
```

### 3. Access the Dashboard
The dashboard is exposed as a **NodePort** service on port **30100**.

**Access URLs:**
- **Minikube**: `http://$(minikube ip):30100`
- **Docker Desktop**: `http://localhost:30100`
- **Kind**: `http://localhost:30100`
- **Cloud K8s**: `http://<node-ip>:30100`

## Features

### Real-time Monitoring
- **Collaboration Pods**: Live view of all collaboration-service instances and user distribution
- **Database Cluster**: Master/replica status and synchronization state
- **Redis Cluster**: Node count and health status
- **System Metrics**: Active users, messages/sec, load distribution

### Auto-Discovery
The dashboard automatically discovers:
- All running pods in the cluster
- Service endpoints
- Database topology
- Redis cluster nodes

### WebSocket Updates
Metrics update every **2 seconds** via WebSocket for real-time visualization.

## Architecture

```
┌─────────────────┐
│   Browser       │
│  localhost:30100│
└────────┬────────┘
         │ HTTP/WS
         ▼
┌─────────────────────────┐
│ testing-dashboard Pod   │
│ ┌─────────────────────┐ │
│ │  Express Server     │ │
│ │  WebSocket Server   │ │
│ │  K8s API Client     │ │
│ └─────────────────────┘ │
└────────┬────────────────┘
         │ K8s API
         ▼
┌─────────────────────────┐
│  Kubernetes API Server  │
│  - Pod Metrics          │
│  - Service Discovery    │
└─────────────────────────┘
```

## RBAC Permissions
The dashboard requires Kubernetes API access to read pod and service information. The deployment includes:
- **ServiceAccount**: `testing-dashboard-sa`
- **ClusterRole**: Read-only access to pods, services, deployments, statefulsets
- **ClusterRoleBinding**: Binds the role to the service account

## Scaling
The dashboard is designed to run as a **single instance** (replicas: 1) since it only provides monitoring and doesn't handle user requests.

## Troubleshooting

### Dashboard shows "No Data"
```bash
# Check if the dashboard pod is running
kubectl get pods -l app=testing-dashboard

# Check logs
kubectl logs -l app=testing-dashboard

# Verify RBAC permissions
kubectl auth can-i list pods --as=system:serviceaccount:default:testing-dashboard-sa
```

### Can't Access on Port 30100
```bash
# Verify service is created
kubectl get svc testing-dashboard

# Check NodePort
kubectl describe svc testing-dashboard | grep NodePort

# For Minikube, get the IP
minikube ip
```

### Dashboard Pod Won't Start
```bash
# Check events
kubectl describe pod -l app=testing-dashboard

# Common issues:
# - Image not built (run build-images.ps1)
# - ImagePullPolicy set to Always but using local image
```

## Integration with Tests

The test scripts can now use the dashboard service:

```javascript
// In your test scripts
const DASHBOARD_URL = 'http://testing-dashboard:3100';

// Dashboard will show test activity in real-time
```

## Updating the Dashboard

After making code changes:
```bash
# Rebuild image
docker build -t testing-dashboard:latest -f ./services/testing-dashboard/Dockerfile ./services/testing-dashboard

# Restart the pod (Kubernetes will pull new image)
kubectl rollout restart deployment testing-dashboard

# Or delete and redeploy
kubectl delete -f k8s/services/testing-dashboard.yaml
kubectl apply -f k8s/services/testing-dashboard.yaml
```

## Monitoring Dashboard Health

```bash
# Check if dashboard is ready
kubectl get pods -l app=testing-dashboard

# View logs
kubectl logs -f -l app=testing-dashboard

# Test HTTP endpoint
curl http://localhost:30100/

# Test WebSocket (requires wscat)
npm install -g wscat
wscat -c ws://localhost:30100
```

## Production Deployment

For production environments:

1. **Change to LoadBalancer**:
   ```yaml
   spec:
     type: LoadBalancer  # Instead of NodePort
   ```

2. **Add Ingress**:
   ```yaml
   apiVersion: networking.k8s.io/v1
   kind: Ingress
   metadata:
     name: testing-dashboard-ingress
   spec:
     rules:
       - host: dashboard.yourdomain.com
         http:
           paths:
             - path: /
               pathType: Prefix
               backend:
                 service:
                   name: testing-dashboard
                   port:
                     number: 3100
   ```

3. **Add Authentication**: Implement JWT or basic auth to protect the dashboard

## Next Steps

1. Deploy the dashboard: `kubectl apply -f k8s/services/testing-dashboard.yaml`
2. Open browser: `http://localhost:30100`
3. Run load tests to see live metrics
4. Monitor failover tests in real-time

The dashboard is now a **first-class service** in your distributed architecture! 🎉
