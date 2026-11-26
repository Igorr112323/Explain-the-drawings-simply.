@echo off
rem ============================================================================
rem  IkGuide - локальный бэкенд на Windows.
rem
rem  Двойной щелчок запускает Python-сервис распознавания 2D-чертежей (:8000).
rem  Он слушает только 127.0.0.1: наружу ничего не открыто, и файлы не покидают
rem  компьютер. Ничего не устанавливается в систему - всё живёт в .venv внутри
rem  папки сервиса.
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
  echo [2/2] OCR-движок распознавания (RapidOCR)...
  services\vision-api\.venv\Scripts\python.exe -m pip install -r services\vision-api\requirements-ocr.txt
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
echo.
echo   Распознавание 2D-чертежей: http://127.0.0.1:8000/health
echo.
echo   Эти окна нельзя закрывать, пока студия работает.
echo   Остановить серверы: Ctrl+C в каждом окне.
echo.

start "IkGuide - распознавание :8000" /D "%CD%" cmd /k services\vision-api\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir services\vision-api --host 127.0.0.1 --port 8000

echo Сервер запущен в отдельном окне.
timeout /t 4 >nul
endlocal
