@echo off
title Mis Cobros - Servidor local
cd /d "%~dp0"

echo.
echo ========================================
echo          MIS COBROS
echo ========================================
echo.
echo Iniciando servidor local...
echo.

where py >nul 2>nul
if %errorlevel%==0 (
    set "PYTHON_CMD=py"
) else (
    where python >nul 2>nul
    if %errorlevel%==0 (
        set "PYTHON_CMD=python"
    ) else (
        echo.
        echo ERROR: No se encontro Python instalado.
        echo.
        echo Instala Python desde https://www.python.org/downloads/
        echo y asegurate de marcar "Add Python to PATH".
        echo.
        pause
        exit /b 1
    )
)

start "" "http://localhost:8000"

echo La app se abrira en:
echo http://localhost:8000
echo.
echo NO cierres esta ventana mientras uses la app.
echo Para detener el servidor, cerra esta ventana.
echo.

%PYTHON_CMD% -m http.server 8000
pause
