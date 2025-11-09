@echo off
set "OSRM_URL=https://router.project-osrm.org"
set "APP_PORT=8000"
".venv\Scripts\python.exe" -m uvicorn app:app --host 127.0.0.1 --port 8000 --log-level info >> "backend.log" 2>&1
