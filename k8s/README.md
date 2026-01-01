# Kubernetes Deployment Guide

This directory contains the Kubernetes manifests to deploy the Multi-User Distributed Text Editor.

## Prerequisites

-   A Kubernetes cluster (local: Minikube, Kind, Docker Desktop; or cloud: GKE, EKS, AKS).
-   `kubectl` installed and configured.
-   `kustomize` (optional, usually built into `kubectl`).

## Directory Structure

-   `infrastructure/`: Stateful services (Postgres, Redis, Kafka, MinIO).
-   `services/`: Microservices (API Gateway, Auth, Document, etc.).
-   `frontend/`: React Client and Nginx Load Balancer.

## Deployment

### Option 1: Using Kustomize (Recommended)

You can apply all manifests at once using `kustomize`:

```bash
kubectl apply -k .
```

### Option 2: Manual Application

If you prefer to apply them one by one (order matters):

1.  **Infrastructure**:
    ```bash
    kubectl apply -f infrastructure/postgres/
    kubectl apply -f infrastructure/redis/
    kubectl apply -f infrastructure/kafka/
    kubectl apply -f infrastructure/minio/
    ```
    *Wait for stateful sets to be ready.*

2.  **Services**:
    ```bash
    kubectl apply -f services/
    ```

3.  **Frontend**:
    ```bash
    kubectl apply -f frontend/
    ```

## Verification

Check the status of the pods:

```bash
kubectl get pods
```

Access the application:
-   If using **Docker Desktop** or **Minikube** with `minikube tunnel`, the Nginx LoadBalancer should be available at `http://localhost`.
-   Otherwise, check the external IP of the `nginx-lb` service:
    ```bash
    kubectl get svc nginx-lb
    ```


## Rebuilding Infrastructure

> **🔄 Fully Automatic**: The infrastructure is now self-healing. After a rebuild, just wait 2-3 minutes - Kafka and Redis will automatically fix any initialization issues without manual intervention!

If you need to rebuild the infrastructure (due to crashes, misconfigurations, or cluster ID mismatches), use the provided cleanup scripts:

### Quick Rebuild

Use the unified rebuild script for a complete infrastructure reset:

```bash
./scripts/rebuild-infrastructure.sh
```

This script will:
1. Clean Kafka metadata (fixing Cluster ID mismatches)
2. Reset Redis cluster (clearing stale IP configurations)
3. Reapply all infrastructure manifests
4. Wait for all pods to be ready

**Options:**
- `--skip-kafka`: Skip Kafka cleanup
- `--skip-redis`: Skip Redis cleanup
- `--force` or `-f`: Skip confirmation prompt

### Individual Component Cleanup

**Kafka Cleanup** (fixes Cluster ID mismatches):
```bash
./scripts/cleanup-kafka.sh
```

**Redis Cleanup** (fixes stale node configurations):
```bash
./scripts/cleanup-redis.sh
```

## Troubleshooting

### Kafka: Cluster ID Mismatch

**Symptoms:**
- Kafka pod in `CrashLoopBackOff`
- Error: "The Cluster ID doesn't match stored clusterId"
- Reconciliation services showing `ECONNREFUSED` to Kafka

**Solution:**
```bash
./scripts/cleanup-kafka.sh
kubectl apply -f k8s/infrastructure/kafka/kafka.yaml
```

### Redis: Stale IP Addresses

**Symptoms:**
- Redis init job failing
- Error: "Host is unreachable" in cluster check
- Nodes showing as "disconnected" in `nodes.conf`

**Solution:**
```bash
./scripts/cleanup-redis.sh
```

The robust initialization job will automatically detect and fix stale configurations.

### General Pod Issues

**Check pod status:**
```bash
kubectl get pods
kubectl describe pod <pod-name>
kubectl logs <pod-name>
```

**Common fixes:**
1. Delete the pod and let it recreate: `kubectl delete pod <pod-name>`
2. Restart a deployment: `kubectl rollout restart deployment <deployment-name>`
3. Check events: `kubectl get events --sort-by='.lastTimestamp'`

## Notes

-   **Persistence**: The manifests use `PersistentVolumeClaims`. Ensure your cluster supports dynamic provisioning.
-   **Secrets**: Secrets are currently stored in `services/secrets.yaml`. **Do not commit this file to a public repository.**
-   **Redis Initialization**: A Job `redis-cluster-init` runs automatically to set up the Redis cluster with robust error handling.
-   **Kafka Resilience**: The Kafka manifest includes init containers to detect and prevent cluster ID mismatches.
