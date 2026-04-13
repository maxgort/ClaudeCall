#Requires -Version 5

$ErrorActionPreference = "Stop"

Set-Location -Path $PSScriptRoot

Write-Host "=== ClaudeCall installer ===" -ForegroundColor Cyan
Write-Host ""

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Error "Node.js 20+ is required but not found on PATH."
    exit 1
}

$versionRaw = & node -p "process.versions.node.split('.')[0]"
if ([int]$versionRaw -lt 20) {
    Write-Error "Node.js 20+ required, found $(node -v)."
    exit 1
}

Write-Host "Installing npm dependencies..."
& npm install --silent
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

Write-Host ""
Write-Host "Initializing ~/.claudecall/ ..."
& node skill/scripts/init_db.mjs
if ($LASTEXITCODE -ne 0) { throw "init_db failed" }

Write-Host ""
Write-Host "Patching Claude Desktop config..."
& node skill/scripts/install_config.mjs
if ($LASTEXITCODE -ne 0) { throw "install_config failed" }

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Edit $env:USERPROFILE\.claudecall\config.env with your credentials"
Write-Host "  2. Edit $env:USERPROFILE\.claudecall\profile.json to match your style"
Write-Host "  3. Restart Claude Desktop"
Write-Host "  4. Try: 'Draft an email to someone@example.com saying hi'"
