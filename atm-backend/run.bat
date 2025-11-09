@echo off
setlocal

rem ===== Config =====
set "PORT=8000"
set "OSRM_URL=https://router.project-osrm.org"
set "LOGFILE=backend.log"
set "VENV=.venv"
set "PYTHON=%VENV%\Scripts\python.exe"

rem ===== Always run from this .bat's folder =====
cd /d "%~dp0" || (echo [!] Cannot cd to %~dp0 & pause & exit /b 1)

rem ===== Must have app.py here =====
if not exist "app.py" (
  echo [!] app.py not found in %CD%
  pause
  exit /b 1
)

rem ===== Create venv + deps on first run =====
if not exist "%PYTHON%" (
  echo [*] Creating venv and installing deps...
  py -m venv "%VENV%" || (echo [!] venv creation failed & pause & exit /b 1)
  call "%VENV%\Scripts\pip.exe" install --upgrade pip
  call "%VENV%\Scripts\pip.exe" install fastapi uvicorn or-tools requests pydantic
)

rem ===== Prepare helper launcher so START logs correctly =====
> "_run_backend.cmd" (
  echo @echo off
  echo set "OSRM_URL=%OSRM_URL%"
  echo set "APP_PORT=%PORT%"
  echo "%PYTHON%" -m uvicorn app:app --host 127.0.0.1 --port %PORT% --log-level info ^>^> "%LOGFILE%" 2^>^&1
)

rem ===== Clean old log and launch backend minimized =====
if exist "%LOGFILE%" del "%LOGFILE%" >nul 2>&1
echo [*] Starting backend on http://127.0.0.1:%PORT%  (log: %LOGFILE%)
start "" /MIN "%CD%\_run_backend.cmd"

rem ===== Wait until /health is ready (max ~20s) =====
set "READY="
for /L %%i in (1,1,20) do (
  rem Try curl first
  curl -s -o nul -w "%%{http_code}" http://127.0.0.1:%PORT%/health > tmpcode.txt 2>nul
  set /p CODE=<tmpcode.txt
  del /q tmpcode.txt >nul 2>&1

  if "x%CODE%"=="x200" (
    set "READY=1"
    goto :READY
  )

  rem Fallback: PowerShell (in case curl missing)
  powershell -NoProfile -Command ^
    "try {$r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:%env:PORT%/health -Method GET -TimeoutSec 2; if ($r.StatusCode -eq 200){exit 0} else {exit 1}} catch {exit 1}"
  if not errorlevel 1 (
    set "READY=1"
    goto :READY
  )

  timeout /t 1 >nul
)

:READY
if not defined READY (
  echo [!] Backend not ready. Opening log...
  if exist "%LOGFILE%" ( notepad "%LOGFILE%" ) else ( echo [!] No log file created. )
  exit /b 1
)

rem ===== Open UI (mounted at /ui/) =====
start "" "http://127.0.0.1:%PORT%/ui/"
exit /b 0
