@echo off
rem ============================================================================
rem  IkGuide - локальный бэкенд на Windows.
rem
rem  Двойной щелчок запускает два Python-сервиса (распознавание чертежей :8000 и
rem  3D-модели :8001). Оба слушают только 127.0.0.1: наружу ничего не открыто, и
rem  файлы не покидают компьютер. Ничего не устанавливается в систему - всё живёт
rem  в .venv внутри папки сервиса.
rem
rem  Первый запуск: py -3 scripts\start-backend.bat install
rem  Обычный запуск: scripts\start-backend.bat
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
echo   IkGuide: локальный бэкенд
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

echo.
echo   Распознавание чертежей:  http://127.0.0.1:8000/health
echo   Сервис 3D:               http://127.0.0.1:8001/v1/cad/health
echo.
echo   Эти окна нельзя закрывать, пока студия работает.
echo   Остановить серверы: Ctrl+C в каждом окне.
echo.

start "IkGuide - распознавание :8000" /D "%CD%" cmd /k services\vision-api\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir services\vision-api --host 127.0.0.1 --port 8000
start "IkGuide - 3D :8001" /D "%CD%" cmd /k services\cad-api\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir services\cad-api --host 127.0.0.1 --port 8001

echo Серверы запущены в отдельных окнах.
timeout /t 4 >nul
endlocal
