@echo off

REM --- Luon chay tai thu muc chua file BAT ---
cd /d "%~dp0"

REM --- Cau hinh ---
set "PORT=8000"
set "VENV=.venv"
set "PYTHON=%VENV%\Scripts\python.exe"

echo -----------------------------------------
echo [*] ATM Route Planner - start app
echo [*] Thu muc: %CD%
echo -----------------------------------------

REM --- Tao venv neu chua co ---
if not exist "%PYTHON%" (
  echo [*] Tao virtualenv...
  py -m venv "%VENV%"
  if errorlevel 1 (
    echo [!] Loi tao virtualenv. Kiem tra lai Python/lenh py.
    pause
    exit /b 1
  )

  echo [*] Cai thu vien lan dau...
  call "%VENV%\Scripts\pip.exe" install --upgrade pip
  call "%VENV%\Scripts\pip.exe" install fastapi uvicorn ortools requests pydantic
)

REM --- Start backend trong cua so rieng (co log day du) ---
echo [*] Khoi dong backend...
start "ATM-Backend" /D "%CD%" "%PYTHON%" app.py

REM --- Mo giao dien (khong doi health check nua, don gian cho chac an) ---
echo [*] Mo giao dien web...
start "" "http://127.0.0.1:%PORT%/"

echo [*] Done. Co the dong cua so nay neu muon.
exit /b
