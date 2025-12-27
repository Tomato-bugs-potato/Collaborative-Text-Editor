#!/bin/bash
# Cleanup script for Redis cluster
# This resolves stale IP address issues in nodes.conf

set -e

echo -e "\033[0;36m==> Cleaning up Redis cluster...\033[0m"

# Check if Redis pods exist
REDIS_PODS=$(kubectl get pods -l app=redis -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || true)

if [ -n "$REDIS_PODS" ]; then
    echo -e "\033[0;33mFound Redis pods: $REDIS_PODS\033[0m"
    
    # Reset all Redis nodes
    echo -e "\033[0;33mPerforming CLUSTER RESET HARD on all Redis nodes...\033[0m"
    for i in {0..5}; do
        POD_NAME="redis-cluster-$i"
        echo -e "\033[0;90m  Resetting $POD_NAME...\033[0m"
        kubectl exec "$POD_NAME" -- redis-cli CLUSTER RESET HARD 2>/dev/null || true
    done
    
    # Delete and recreate the initialization job
    echo -e "\033[0;33mRecreating Redis initialization job...\033[0m"
    kubectl delete job redis-cluster-init --ignore-not-found=true
    kubectl apply -f k8s/infrastructure/redis/redis-init-job.yaml
    
    # Wait for the job to complete
    echo -e "\033[0;33mWaiting for Redis initialization to complete...\033[0m"
    if kubectl wait --for=condition=complete job/redis-cluster-init --timeout=120s; then
        echo -e "\033[0;32mRedis cluster reinitialized successfully!\033[0m"
        
        # Verify cluster health
        echo -e "\033[0;33mVerifying cluster health...\033[0m"
        kubectl exec redis-cluster-0 -- redis-cli --cluster check redis-cluster-0.redis-cluster:6379
    else
        echo -e "\033[0;31mRedis initialization job did not complete in time. Check logs:\033[0m"
        echo -e "\033[0m  kubectl logs -l job-name=redis-cluster-init\033[0m"
    fi
else
    echo -e "\033[0;33mNo Redis pods found. Nothing to clean up.\033[0m"
fi
