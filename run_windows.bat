@echo off
setlocal
cd /d "%~dp0"
where python >nul 2>nul || (echo Python 3.10+ is required.& pause & exit /b 1)
where npm >nul 2>nul || (echo Node.js 20+ and npm are required.& pause & exit /b 1)
if not exist .venv python -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r backend\requirements.txt
if not exist frontend\node_modules (cd frontend && npm install && cd ..)
start "Commerce Ledger API" cmd /k ""%~dp0run_api_windows.bat""
start "Commerce Ledger Frontend" cmd /k ""%~dp0run_frontend_windows.bat""
timeout /t 4 >nul
start http://127.0.0.1:5173
echo Commerce Ledger is starting. Keep both API and frontend windows open.
echo Press Ctrl+C in the frontend window to stop Vite and close both windows when finished.
