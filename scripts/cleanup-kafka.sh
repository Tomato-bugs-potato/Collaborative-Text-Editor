#!/bin/bash
# Cleanup script for Kafka metadata and PVCs
# This resolves Cluster ID mismatch issues during rebuilds

set -e

echo -e "\033[0;36m==> Cleaning up Kafka metadata...\033[0m"

# Get Kafka pods
KAFKA_PODS=$(kubectl get pods -l app=kafka -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || true)

if [ -n "$KAFKA_PODS" ]; then
    echo -e "\033[0;33mFound Kafka pods: $KAFKA_PODS\033[0m"
    
    # Delete Kafka StatefulSet (but keep the service)
    echo -e "\033[0;33mDeleting Kafka StatefulSet...\033[0m"
    kubectl delete statefulset kafka --ignore-not-found=true
    
    # Wait for pods to terminate
    echo -e "\033[0;33mWaiting for Kafka pods to terminate...\033[0m"
    kubectl wait --for=delete pod -l app=kafka --timeout=60s 2>/dev/null || true
    
    # Delete Kafka PVCs
    echo -e "\033[0;33mDeleting Kafka PVCs...\033[0m"
    kubectl get pvc | grep kafka-data | awk '{print $1}' | xargs -r kubectl delete pvc
    
    echo -e "\033[0;32mKafka cleanup completed successfully!\033[0m"
else
    echo -e "\033[0;33mNo Kafka pods found. Nothing to clean up.\033[0m"
fi

echo ""
echo -e "\033[0;36mYou can now reapply the Kafka manifest:\033[0m"
echo -e "\033[0m  kubectl apply -f k8s/infrastructure/kafka/kafka.yaml\033[0m"
