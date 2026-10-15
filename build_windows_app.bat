@echo off
setlocal EnableDelayedExpansion
title L'antre du caddrillage - Lanceur & Compilateur Windows

echo ========================================================
echo   L'antre du caddrillage - Application Windows
echo ========================================================
echo.

set PORT=8080
set INDEX_URL=http://localhost:%PORT%/index.html

echo 1. Verification de l'environnement Python...
python --version >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Python est installe.
    start "" msedge --app="%INDEX_URL%" 2>nul || start "" chrome --app="%INDEX_URL%" 2>nul || start "" "%INDEX_URL%"
    echo Serveur en ecoute sur %INDEX_URL%...
    python -m http.server %PORT%
    goto end
)

python3 --version >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Python3 est installe.
    start "" msedge --app="%INDEX_URL%" 2>nul || start "" chrome --app="%INDEX_URL%" 2>nul || start "" "%INDEX_URL%"
    echo Serveur en ecoute sur %INDEX_URL%...
    python3 -m http.server %PORT%
    goto end
)

echo [Info] Ouverture directe dans le navigateur par defaut...
start "" "%~dp0index.html"

:end
pause
