#!/usr/bin/env pwsh
# Cleanup script for Kafka metadata and PVCs
# This resolves Cluster ID mismatch issues during rebuilds

Write-Host "==> Cleaning up Kafka metadata..." -ForegroundColor Cyan

# Get Kafka pods
$kafkaPods = kubectl get pods -l app=kafka -o jsonpath='{.items[*].metadata.name}' 2>$null

if ($LASTEXITCODE -eq 0 -and $kafkaPods) {
    Write-Host "Found Kafka pods: $kafkaPods" -ForegroundColor Yellow
    
    # Delete Kafka StatefulSet (but keep the service)
    Write-Host "Deleting Kafka StatefulSet..." -ForegroundColor Yellow
    kubectl delete statefulset kafka --ignore-not-found=true
    
    # Wait for pods to terminate
    Write-Host "Waiting for Kafka pods to terminate..." -ForegroundColor Yellow
    kubectl wait --for=delete pod -l app=kafka --timeout=60s 2>$null
    
    # Delete Kafka PVCs
    Write-Host "Deleting Kafka PVCs..." -ForegroundColor Yellow
    kubectl get pvc | Select-String "kafka-data" | ForEach-Object {
        $pvcName = ($_ -split '\s+')[0]
        kubectl delete pvc $pvcName
    }
    
    Write-Host "Kafka cleanup completed successfully!" -ForegroundColor Green
} else {
    Write-Host "No Kafka pods found. Nothing to clean up." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "You can now reapply the Kafka manifest:" -ForegroundColor Cyan
Write-Host "  kubectl apply -f k8s/infrastructure/kafka/kafka.yaml" -ForegroundColor White
