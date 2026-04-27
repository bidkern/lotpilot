param(
  [string]$DatabasePassword = "postgres",
  [int]$Port = 5432
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$postgresRoot = Join-Path $root "runtime-data\postgresql"
$binaryRoot = Join-Path $postgresRoot "pgsql16-binaries\pgsql"
$binRoot = Join-Path $binaryRoot "bin"
$dataRoot = Join-Path $postgresRoot "data"
$logPath = Join-Path $postgresRoot "postgres.log"
$pwFilePath = Join-Path $postgresRoot "pgpass.txt"
$pgCtlPath = Join-Path $binRoot "pg_ctl.exe"

if (-not (Test-Path (Join-Path $binRoot "postgres.exe"))) {
  throw "PostgreSQL binaries were not found at $binRoot. Download/extract them first."
}

if (-not (Test-Path $dataRoot)) {
  New-Item -ItemType Directory -Force -Path $postgresRoot | Out-Null
  Set-Content -Path $pwFilePath -Value $DatabasePassword -NoNewline
  & (Join-Path $binRoot "initdb.exe") -D $dataRoot -U postgres "--pwfile=$pwFilePath" -A scram-sha-256
}

& $pgCtlPath -D $dataRoot status | Out-Null
if ($LASTEXITCODE -eq 0) {
  Write-Output "PostgreSQL is already running on port $Port using data dir $dataRoot"
  exit 0
}

& $pgCtlPath -D $dataRoot -l $logPath -o " -p $Port" start | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "PostgreSQL failed to start. Check $logPath for details."
}

Write-Output "PostgreSQL started on port $Port using data dir $dataRoot"
