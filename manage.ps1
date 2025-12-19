# Management script for Distributed Text Editor

param (
    [Parameter(Mandatory=$true)]
    [ValidateSet("start", "stop", "reset", "logs")]
    [string]$Command
)

$ComposeFile = "docker-compose.distributed.yml"

switch ($Command) {
    "start" {
        Write-Host "Starting services... (Building if necessary)" -ForegroundColor Green
        docker-compose -f $ComposeFile up --build -d
        Write-Host "Services started." -ForegroundColor Green
    }
    "stop" {
        Write-Host "Stopping services... (Preserving data volumes)" -ForegroundColor Yellow
        docker-compose -f $ComposeFile down
        Write-Host "Services stopped. Data preserved." -ForegroundColor Green
    }
    "reset" {
        Write-Host "WARNING: This will delete all data volumes!" -ForegroundColor Red
        $confirmation = Read-Host "Are you sure? (y/N)"
        if ($confirmation -eq 'y') {
            Write-Host "Stopping services and removing volumes..." -ForegroundColor Red
            docker-compose -f $ComposeFile down -v
            Write-Host "Reset complete." -ForegroundColor Green
        } else {
            Write-Host "Reset cancelled." -ForegroundColor Yellow
        }
    }
    "logs" {
        docker-compose -f $ComposeFile logs -f
    }
}
