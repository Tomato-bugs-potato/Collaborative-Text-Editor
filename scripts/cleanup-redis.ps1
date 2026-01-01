#!/usr/bin/env pwsh
# Cleanup script for Redis cluster
# This resolves stale IP address issues in nodes.conf

Write-Host "==> Cleaning up Redis cluster..." -ForegroundColor Cyan

# Check if Redis pods exist
$redisPods = kubectl get pods -l app=redis -o jsonpath='{.items[*].metadata.name}' 2>$null

if ($LASTEXITCODE -eq 0 -and $redisPods) {
    Write-Host "Found Redis pods: $redisPods" -ForegroundColor Yellow
    
    # Reset all Redis nodes
    Write-Host "Performing CLUSTER RESET HARD on all Redis nodes..." -ForegroundColor Yellow
    0..5 | ForEach-Object {
        $podName = "redis-cluster-$_"
        Write-Host "  Resetting $podName..." -ForegroundColor Gray
        kubectl exec $podName -- redis-cli CLUSTER RESET HARD 2>$null
    }
    
    # Delete and recreate the initialization job
    Write-Host "Recreating Redis initialization job..." -ForegroundColor Yellow
    kubectl delete job redis-cluster-init --ignore-not-found=true
    kubectl apply -f k8s/infrastructure/redis/redis-init-job.yaml
    
    # Wait for the job to complete
    Write-Host "Waiting for Redis initialization to complete..." -ForegroundColor Yellow
    kubectl wait --for=condition=complete job/redis-cluster-init --timeout=120s
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Redis cluster reinitialized successfully!" -ForegroundColor Green
        
        # Verify cluster health
        Write-Host "Verifying cluster health..." -ForegroundColor Yellow
        kubectl exec redis-cluster-0 -- redis-cli --cluster check redis-cluster-0.redis-cluster:6379
    } else {
        Write-Host "Redis initialization job did not complete in time. Check logs:" -ForegroundColor Red
        Write-Host "  kubectl logs -l job-name=redis-cluster-init" -ForegroundColor White
    }
} else {
    Write-Host "No Redis pods found. Nothing to clean up." -ForegroundColor Yellow
}
