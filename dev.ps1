# SpeedTune dev launcher — kills stale processes, loads .env.local, starts backend + frontend
# Run from the repo root: .\dev.ps1

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# ── Kill any existing instances ─────────────────────────────────────────────
Write-Host "Stopping any running SpeedTune processes..." -ForegroundColor Yellow
Stop-Process -Name "SpeedTune.Api" -Force -ErrorAction SilentlyContinue
# Give dotnet a moment to release file locks
Start-Sleep -Milliseconds 500

# ── Load .env.local into the current process so child windows inherit it ────
$envFile = "$root\.env.local"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        # Skip blank lines and comments
        if ($_ -match '^\s*([^#=][^=]*?)\s*=\s*(.*?)\s*$') {
            $varName  = $Matches[1].Trim()
            $varValue = $Matches[2].Trim()
            Set-Item "env:$varName" $varValue
        }
    }
    Write-Host "Loaded .env.local" -ForegroundColor DarkGray
}

# ── Start backend ────────────────────────────────────────────────────────────
Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "cd '$root\backend'; dotnet run" `
    -WindowStyle Normal

# ── Start frontend ───────────────────────────────────────────────────────────
Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "cd '$root\frontend'; npm run dev" `
    -WindowStyle Normal

Write-Host ""
Write-Host "SpeedTune started!" -ForegroundColor Green
Write-Host "  Frontend : http://localhost:5173" -ForegroundColor Cyan
Write-Host "  Backend  : http://localhost:5000" -ForegroundColor Cyan
