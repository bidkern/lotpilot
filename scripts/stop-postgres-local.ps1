$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dataRoot = Join-Path $root "runtime-data\postgresql\data"
$pgCtl = Join-Path $root "runtime-data\postgresql\pgsql16-binaries\pgsql\bin\pg_ctl.exe"

if (-not (Test-Path $pgCtl) -or -not (Test-Path $dataRoot)) {
  Write-Output "Local PostgreSQL is not initialized."
  exit 0
}

& $pgCtl -D $dataRoot stop | Out-Null
Write-Output "PostgreSQL stopped."
