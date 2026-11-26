@echo off
rem ============================================================================
rem  ИК-Гайд — цеховой сервер на Windows.
rem
rem  Двойной щелчок запускает два Python-сервиса (распознавание чертежей :8000 и
rem  3D-модели :8001) и печатает адреса, которые нужно вписать в планшете в
rem  «Настройки и подключение». Ничего не устанавливается в систему: всё живёт в
rem  .venv внутри папки сервиса.
rem
rem  Первый запуск: py -3 scripts\start-workshop-servers.bat install
rem  Обычный запуск: scripts\start-workshop-servers.bat
rem ============================================================================
setlocal EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0.."

set "MODE=%~1"
if "%MODE%"=="" set "MODE=run"

where py >nul 2>nul
if errorlevel 1 (
  echo [x] Не найден Python. Установите Python 3.11+ с python.org и повторите.
  pause
  exit /b 1
)

set "PY=py -3"

echo.
echo ============================================================
echo   ИК-Гайд: цеховой сервер
echo ============================================================

if /I "%MODE%"=="install" (
  echo [1/2] Зависимости сервиса распознавания...
  %PY% -m venv services\vision-api\.venv
  services\vision-api\.venv\Scripts\python.exe -m pip install --upgrade pip
  services\vision-api\.venv\Scripts\python.exe -m pip install -r services\vision-api\requirements.txt
  echo [2/2] Зависимости сервиса 3D...
  %PY% -m venv services\cad-api\.venv
  services\cad-api\.venv\Scripts\python.exe -m pip install --upgrade pip
  services\cad-api\.venv\Scripts\python.exe -m pip install -r services\cad-api\requirements.txt
  echo.
  echo Готово. Теперь запускайте этот файл без аргументов.
  pause
  exit /b 0
)

if not exist services\vision-api\.venv\Scripts\python.exe (
  echo [x] Сначала установите зависимости: %~nx0 install
  pause
  exit /b 1
)
if not exist services\cad-api\.venv\Scripts\python.exe (
  echo [x] Сначала установите зависимости: %~nx0 install
  pause
  exit /b 1
)

for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /c:"IPv4"') do (
  set "LAN_IP=%%A"
  goto :got_ip
)
:got_ip
set "LAN_IP=%LAN_IP: =%"
if "%LAN_IP%"=="" set "LAN_IP=127.0.0.1"

echo.
echo   Сервис распознавания:  http://%LAN_IP%:8000/health
echo   Сервис 3D:             http://%LAN_IP%:8001/v1/cad/health
echo.
echo   Впишите в планшете в «Настройки и подключение»:
echo     распознавание: http://%LAN_IP%:8000
echo     3D-модели:     http://%LAN_IP%:8001
echo.
echo   Это окно нельзя закрывать, пока идут работы в цехе.
echo   Остановить серверы: Ctrl+C
echo.

start "ИК-Гайд · распознавание :8000" /D "%CD%" cmd /k services\vision-api\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir services\vision-api --host 0.0.0.0 --port 8000
start "ИК-Гайд · 3D :8001" /D "%CD%" cmd /k services\cad-api\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir services\cad-api --host 0.0.0.0 --port 8001

echo Серверы запущены в отдельных окнах. Закройте окна, чтобы остановить.
timeout /t 6 >nul
start "" "http://%LAN_IP%:8000/health"
endlocal
