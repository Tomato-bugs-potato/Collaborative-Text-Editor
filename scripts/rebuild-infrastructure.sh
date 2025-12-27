#!/bin/bash
# Unified script to rebuild entire infrastructure
# Handles cleanup and reapplication of all manifests

set -e

SKIP_KAFKA=false
SKIP_REDIS=false
FORCE=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-kafka)
            SKIP_KAFKA=true
            shift
            ;;
        --skip-redis)
            SKIP_REDIS=true
            shift
            ;;
        --force|-f)
            FORCE=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--skip-kafka] [--skip-redis] [--force]"
            exit 1
            ;;
    esac
done

echo -e "\033[0;36m========================================\033[0m"
echo -e "\033[0;36m  Infrastructure Rebuild Script\033[0m"
echo -e "\033[0;36m========================================\033[0m"
echo ""

# Confirm with user unless -f/--force is specified
if [ "$FORCE" = false ]; then
    read -p "This will clean and rebuild infrastructure. Continue? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "\033[0;33mRebuild cancelled.\033[0m"
        exit 0
    fi
fi

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Step 1: Clean Kafka if not skipped
if [ "$SKIP_KAFKA" = false ]; then
    echo ""
    echo -e "\033[0;36mStep 1: Cleaning Kafka...\033[0m"
    bash "$SCRIPT_DIR/cleanup-kafka.sh"
else
    echo -e "\033[0;33mSkipping Kafka cleanup...\033[0m"
fi

# Step 2: Clean Redis if not skipped
if [ "$SKIP_REDIS" = false ]; then
    echo ""
    echo -e "\033[0;36mStep 2: Cleaning Redis...\033[0m"
    bash "$SCRIPT_DIR/cleanup-redis.sh"
else
    echo -e "\033[0;33mSkipping Redis cleanup...\033[0m"
fi

# Step 3: Reapply infrastructure manifests
echo ""
echo -e "\033[0;36mStep 3: Reapplying infrastructure manifests...\033[0m"

MANIFESTS=(
    "k8s/infrastructure/redis/redis-configmap.yaml"
    "k8s/infrastructure/redis/redis-service.yaml"
    "k8s/infrastructure/redis/redis-statefulset.yaml"
    "k8s/infrastructure/redis/redis-init-job.yaml"
    "k8s/infrastructure/kafka/zookeeper.yaml"
    "k8s/infrastructure/kafka/kafka.yaml"
)

for manifest in "${MANIFESTS[@]}"; do
    if [ -f "$manifest" ]; then
        echo -e "\033[0;90m  Applying $manifest...\033[0m"
        kubectl apply -f "$manifest"
    else
        echo -e "\033[0;33m  Warning: $manifest not found, skipping...\033[0m"
    fi
done

# Step 4: Wait for pods to be ready
echo ""
echo -e "\033[0;36mStep 4: Waiting for infrastructure pods to be ready...\033[0m"

INFRASTRUCTURE_PODS=(
    "redis-cluster-0"
    "redis-cluster-1"
    "redis-cluster-2"
    "redis-cluster-3"
    "redis-cluster-4"
    "redis-cluster-5"
    "kafka-0"
)

for pod in "${INFRASTRUCTURE_PODS[@]}"; do
    echo -e "\033[0;90m  Waiting for $pod...\033[0m"
    kubectl wait --for=condition=ready pod/"$pod" --timeout=120s 2>/dev/null || true
done

# Wait for zookeeper deployment
kubectl wait --for=condition=ready pod -l app=zookeeper --timeout=120s 2>/dev/null || true

echo ""
echo -e "\033[0;32m========================================\033[0m"
echo -e "\033[0;32m  Infrastructure rebuild completed!\033[0m"
echo -e "\033[0;32m========================================\033[0m"
echo ""
echo -e "\033[0;36mNext steps:\033[0m"
echo -e "\033[0m  1. Check pod status: kubectl get pods\033[0m"
echo -e "\033[0m  2. Apply service manifests: kubectl apply -f k8s/services/\033[0m"
echo -e "\033[0m  3. Verify logs: kubectl logs -l app=reconciliation-service-docs\033[0m"
