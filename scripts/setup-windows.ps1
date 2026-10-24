# ============================================================
#  Aether Browser - one-shot Windows 11 setup / repair script
#  Run from the project folder in PowerShell:
#    powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
# ============================================================

$ErrorActionPreference = "Continue"
Write-Host ""
Write-Host "=== Aether Browser - Windows setup ===" -ForegroundColor Cyan

# --- 1. Node.js version check (needs >= 18) ---
$nodeOk = $false
try {
    $v = (& node --version) 2>$null
    if ($v -match "^v(\d+)") { if ([int]$Matches[1] -ge 18) { $nodeOk = $true } }
    Write-Host "[ok] Node.js $v" -ForegroundColor Green
} catch { }
if (-not $nodeOk) {
    Write-Host "[FAIL] Node.js 18+ is required. Install it from https://nodejs.org and re-run." -ForegroundColor Red
    exit 1
}

# --- 2. npm install (installs all dependencies) ---
Write-Host "`n[1/4] Installing dependencies (npm install)..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAIL] npm install failed. Close VS Code, run PowerShell as Administrator once, and try again." -ForegroundColor Red
    exit 1
}

# --- 3. Electron binary check + mirror repair ---
Write-Host "`n[2/4] Checking the Electron binary..." -ForegroundColor Yellow
$electronExe = Join-Path (Get-Location) "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electronExe)) {
    Write-Host "     Missing - repairing via fast mirror..." -ForegroundColor Yellow
    $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
    Remove-Item -Recurse -Force node_modules\electron -ErrorAction SilentlyContinue
    npm install electron
    if (Test-Path $electronExe) {
        Write-Host "[ok] Electron repaired." -ForegroundColor Green
    } else {
        Write-Host "[FAIL] Electron still missing. Add an antivirus exclusion for this folder, then run:" -ForegroundColor Red
        Write-Host "       node node_modules\electron\install.js" -ForegroundColor White
        exit 1
    }
} else {
    Write-Host "[ok] Electron binary present." -ForegroundColor Green
}

# --- 4. Ollama check ---
Write-Host "`n[3/4] Checking Ollama (local AI)..." -ForegroundColor Yellow
try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:11434" -UseBasicParsing -TimeoutSec 4
    Write-Host "[ok] Ollama is running ($($r.Content.Trim().Substring(0, [Math]::Min(40, $r.Content.Trim().Length))))" -ForegroundColor Green
} catch {
    Write-Host "[warn] Ollama is not reachable at http://127.0.0.1:11434" -ForegroundColor Yellow
    Write-Host "       - Install it from https://ollama.com" -ForegroundColor Gray
    Write-Host "       - Start the Ollama app (it lives in the system tray)" -ForegroundColor Gray
    Write-Host "       - Pull a model:  ollama pull qwen3.5:4b" -ForegroundColor Gray
    Write-Host "       Aether will still run; the AI sidebar will show a red dot until Ollama is up." -ForegroundColor Gray
}

# --- done ---
Write-Host "`n[4/4] Ready!" -ForegroundColor Yellow
Write-Host ""
Write-Host "Start the browser:" -ForegroundColor Cyan
Write-Host "    npm run dev" -ForegroundColor White
Write-Host ""
Write-Host "Build a Windows installer (optional):" -ForegroundColor Cyan
Write-Host "    npm run dist" -ForegroundColor White
Write-Host ""
