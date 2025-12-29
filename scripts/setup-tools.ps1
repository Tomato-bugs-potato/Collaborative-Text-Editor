# Helper script to install useful developer tools for this project

Write-Host "Setting up developer tools..." -ForegroundColor Cyan

# Function to install k9s
function Install-K9s {
    Write-Host "Checking for k9s..."
    if (Get-Command "k9s" -ErrorAction SilentlyContinue) {
        Write-Host "k9s is already installed." -ForegroundColor Green
        return
    }

    Write-Host "Installing k9s..." -ForegroundColor Yellow
    
    # Create tools directory if it doesn't exist
    $toolsDir = Join-Path $PSScriptRoot "..\tools"
    if (-not (Test-Path $toolsDir)) {
        New-Item -ItemType Directory -Path $toolsDir | Out-Null
    }

    # Download k9s
    $url = "https://github.com/derailed/k9s/releases/download/v0.32.5/k9s_Windows_amd64.zip"
    $zipPath = Join-Path $toolsDir "k9s.zip"
    
    try {
        Invoke-WebRequest -Uri $url -OutFile $zipPath
        Expand-Archive -Path $zipPath -DestinationPath $toolsDir -Force
        Remove-Item $zipPath
        
        Write-Host "k9s installed to $toolsDir" -ForegroundColor Green
        Write-Host "You can run it using: .\tools\k9s.exe" -ForegroundColor Cyan
        
        # Add to path for this session
        $env:Path += ";$toolsDir"
    }
    catch {
        Write-Host "Failed to install k9s: $_" -ForegroundColor Red
    }
}

Install-K9s

Write-Host "`nSetup complete!" -ForegroundColor Green
