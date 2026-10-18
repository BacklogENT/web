$mysqlHome = Join-Path $env:LOCALAPPDATA 'Programs\MySQL-8.4-portable\mysql-8.4.9-winx64'
$dataDirectory = Join-Path $env:LOCALAPPDATA 'MySQL-Backlog-Data'
$mysqlServer = Join-Path $mysqlHome 'bin\mysqld.exe'

if (-not (Test-Path $mysqlServer)) {
  throw "MySQL was not found at $mysqlServer. Install MySQL Server or correct the path in backend/start-mysql.ps1."
}

$listener = Get-NetTCPConnection -LocalPort 3306 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  Write-Host 'A process is already listening on port 3306; no second instance was started.'
  return
}

$runtimeDirectories = @(
  (Join-Path $env:ProgramFiles 'Microsoft Office\root\Office16'),
  (Join-Path $env:ProgramFiles 'Common Files\microsoft shared\ClickToRun')
)
$runtimeDirectory = $runtimeDirectories |
  Where-Object { (Test-Path (Join-Path $_ 'vcruntime140.dll')) -and (Test-Path (Join-Path $_ 'msvcp140.dll')) } |
  Select-Object -First 1

if (-not $runtimeDirectory) {
  throw 'MySQL requires Microsoft Visual C++ Redistributable 2015-2022 x64. Install it and retry.'
}

$env:Path = "$runtimeDirectory;$mysqlHome\bin;$env:Path"
& $mysqlServer --console --basedir="$mysqlHome" --datadir="$dataDirectory" --port=3306 --bind-address=127.0.0.1
