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

## Notes

-   **Persistence**: The manifests use `PersistentVolumeClaims`. Ensure your cluster supports dynamic provisioning.
-   **Secrets**: Secrets are currently stored in `services/secrets.yaml`. **Do not commit this file to a public repository.**
-   **Redis Initialization**: A Job `redis-cluster-init` runs automatically to set up the Redis cluster.
