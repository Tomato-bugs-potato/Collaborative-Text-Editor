#!/usr/bin/env pwsh
# Unified script to rebuild entire infrastructure
# Handles cleanup and reapplication of all manifests

param(
    [switch]$SkipKafka,
    [switch]$SkipRedis,
    [switch]$Force
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Infrastructure Rebuild Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Confirm with user unless -Force is specified
if (-not $Force) {
    $confirmation = Read-Host "This will clean and rebuild infrastructure. Continue? (y/N)"
    if ($confirmation -ne 'y' -and $confirmation -ne 'Y') {
        Write-Host "Rebuild cancelled." -ForegroundColor Yellow
        exit 0
    }
}

# Step 1: Clean Kafka if not skipped
if (-not $SkipKafka) {
    Write-Host ""
    Write-Host "Step 1: Cleaning Kafka..." -ForegroundColor Cyan
    & "$PSScriptRoot\cleanup-kafka.ps1"
} else {
    Write-Host "Skipping Kafka cleanup..." -ForegroundColor Yellow
}

# Step 2: Clean Redis if not skipped
if (-not $SkipRedis) {
    Write-Host ""
    Write-Host "Step 2: Cleaning Redis..." -ForegroundColor Cyan
    & "$PSScriptRoot\cleanup-redis.ps1"
} else {
    Write-Host "Skipping Redis cleanup..." -ForegroundColor Yellow
}

# Step 3: Reapply infrastructure manifests
Write-Host ""
Write-Host "Step 3: Reapplying infrastructure manifests..." -ForegroundColor Cyan

$manifestOrder = @(
    "k8s/infrastructure/redis/redis-configmap.yaml",
    "k8s/infrastructure/redis/redis-service.yaml",
    "k8s/infrastructure/redis/redis-statefulset.yaml",
    "k8s/infrastructure/redis/redis-init-job.yaml",
    "k8s/infrastructure/kafka/zookeeper.yaml",
    "k8s/infrastructure/kafka/kafka.yaml"
)

foreach ($manifest in $manifestOrder) {
    if (Test-Path $manifest) {
        Write-Host "  Applying $manifest..." -ForegroundColor Gray
        kubectl apply -f $manifest
    } else {
        Write-Host "  Warning: $manifest not found, skipping..." -ForegroundColor Yellow
    }
}

# Step 4: Wait for pods to be ready
Write-Host ""
Write-Host "Step 4: Waiting for infrastructure pods to be ready..." -ForegroundColor Cyan

$infrastructurePods = @(
    "redis-cluster-0",
    "redis-cluster-1",
    "redis-cluster-2",
    "redis-cluster-3",
    "redis-cluster-4",
    "redis-cluster-5",
    "kafka-0",
    "zookeeper"
)

foreach ($pod in $infrastructurePods) {
    Write-Host "  Waiting for $pod..." -ForegroundColor Gray
    kubectl wait --for=condition=ready pod -l app=$pod --timeout=120s 2>$null
    if ($LASTEXITCODE -ne 0) {
        # Try waiting by pod name for StatefulSets
        kubectl wait --for=condition=ready pod/$pod --timeout=120s 2>$null
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Infrastructure rebuild completed!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Check pod status: kubectl get pods" -ForegroundColor White
Write-Host "  2. Apply service manifests: kubectl apply -f k8s/services/" -ForegroundColor White
Write-Host "  3. Verify logs: kubectl logs -l app=reconciliation-service-docs" -ForegroundColor White
