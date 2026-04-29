@echo off
setlocal EnableDelayedExpansion

set "PROJECT_DIR=%~dp0"
set "SERVER_WINDOW_TITLE=Autonomous Car Salesman Server"
set "OPEN_BROWSER=1"
set "REUSE_EXISTING=1"
set "OPEN_PATH=/"
set "DEFAULT_PORT=3010"
set "MAX_PORT=3199"
set "PORT_FILE=%PROJECT_DIR%runtime-data\launcher-port.txt"
set "PORT="
set "BASE_URL="
set "APP_URL="

call :parse_args %*

if not defined OPEN_PATH (
  set "OPEN_PATH=/"
)

if not "!OPEN_PATH:~0,1!"=="/" (
  set "OPEN_PATH=/!OPEN_PATH!"
)

if "%REUSE_EXISTING%"=="1" if exist "%PORT_FILE%" (
  set /p PORT=<"%PORT_FILE%"
  if defined PORT (
    call :is_app_live !PORT!
    if not errorlevel 1 (
      set "BASE_URL=http://localhost:!PORT!"
      echo Reusing the existing Autonomous Car Salesman server on !BASE_URL!...
      goto :open_route
    )
  )
)

call :find_port
if errorlevel 1 (
  echo Unable to find an open port between %DEFAULT_PORT% and %MAX_PORT%.
  exit /b 1
)

call :prepare_app
if errorlevel 1 (
  echo The launcher could not prepare the app.
  exit /b 1
)

set "BASE_URL=http://localhost:%PORT%"

echo Starting Autonomous Car Salesman on %BASE_URL%...
start "%SERVER_WINDOW_TITLE%" /min cmd /k "title %SERVER_WINDOW_TITLE% (%PORT%) && cd /d ""%PROJECT_DIR%"" && set NEXTAUTH_URL=%BASE_URL%&& npm.cmd run start -- --port %PORT%"
call :wait_for_app %PORT%
if errorlevel 1 (
  echo Autonomous Car Salesman did not come online on %BASE_URL% in time.
  exit /b 1
)

> "%PORT_FILE%" echo %PORT%

:open_route
set "APP_URL=%BASE_URL%%OPEN_PATH%"
if "%OPEN_BROWSER%"=="1" (
  start "" "%APP_URL%"
)

echo Autonomous Car Salesman is ready at %APP_URL%.
exit /b 0

:parse_args
if "%~1"=="" (
  exit /b 0
)

if /I "%~1"=="--no-browser" (
  set "OPEN_BROWSER=0"
  shift
  goto :parse_args
)

if /I "%~1"=="--new-instance" (
  set "REUSE_EXISTING=0"
  shift
  goto :parse_args
)

if /I "%~1"=="--path" (
  if not "%~2"=="" (
    set "OPEN_PATH=%~2"
    shift
  )
  shift
  goto :parse_args
)

shift
goto :parse_args

:prepare_app
pushd "%PROJECT_DIR%" >nul

if not exist "%PROJECT_DIR%node_modules" (
  echo Installing dependencies...
  call npm.cmd install
  if errorlevel 1 (
    popd >nul
    exit /b 1
  )
)

echo Building the latest Autonomous Car Salesman bundle...
call npm.cmd run build
set "BUILD_STATUS=%errorlevel%"

popd >nul
exit /b %BUILD_STATUS%

:find_port
for /L %%P in (%DEFAULT_PORT%,1,%MAX_PORT%) do (
  call :is_app_live %%P
  if not errorlevel 1 (
    set "PORT=%%P"
    exit /b 0
  )

  call :is_port_free %%P
  if not errorlevel 1 (
    set "PORT=%%P"
    exit /b 0
  )
)

exit /b 1

:is_app_live
set "CHECK_PORT=%~1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$url = 'http://localhost:%CHECK_PORT%'; try { $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2; if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500 -and $response.Content -match 'Autonomous Car Salesman|Autonomous salesperson|Close more buyers|Sales floor mode') { exit 0 } ; exit 1 } catch { exit 1 }"
exit /b %errorlevel%

:is_port_free
set "CHECK_PORT=%~1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$listener = Get-NetTCPConnection -State Listen -LocalPort %CHECK_PORT% -ErrorAction SilentlyContinue; if ($listener) { exit 1 } else { exit 0 }"
exit /b %errorlevel%

:wait_for_app
set "WAIT_PORT=%~1"
set /a ATTEMPT=0

:wait_loop
call :is_app_live %WAIT_PORT%
if not errorlevel 1 (
  exit /b 0
)

set /a ATTEMPT+=1
if %ATTEMPT% geq 60 (
  exit /b 1
)

timeout /t 1 /nobreak >nul
goto wait_loop
