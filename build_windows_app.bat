@echo off
setlocal EnableDelayedExpansion
title L'antre du caddrillage - Lanceur & Compilateur Windows

echo ========================================================
echo   L'antre du caddrillage - Compilateur & Lanceur Windows
echo ========================================================
echo.
echo Ce script fonctionne a 100%% hors-ligne sur votre PC Windows.
echo Vos textes recents sont directement integres depuis seed_writings.json.
echo.

set PORT=8080
set INDEX_URL=http://localhost:%PORT%/index.html

where npx >nul 2>&1
if %errorlevel% equ 0 (
    echo [Option] Node.js et npm sont detectes sur cette machine Windows.
    echo 1. Lancer l'application directement hors-ligne
    echo 2. Compiler un installateur autonome .exe (via Electron)
    set /p USER_CHOICE="Entrez votre choix (1 ou 2) [Defaut: 1] : "
    if "!USER_CHOICE!"=="2" (
        echo.
        echo Construction de l'executable Windows .exe en cours...
        call npx electron-builder --win nsis portable --publish never
        echo.
        echo [Succes] Fichiers .exe generes dans le dossier dist\ :
        dir dist\*.exe 2>nul
        pause
        goto end
    )
)

echo.
echo Lancement du mode autonome local avec vos textes embarques...
python --version >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Serveur local demarre sur %INDEX_URL%...
    start "" msedge --app="%INDEX_URL%" 2>nul || start "" chrome --app="%INDEX_URL%" 2>nul || start "" "%INDEX_URL%"
    python -m http.server %PORT%
    goto end
)

python3 --version >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Serveur local demarre sur %INDEX_URL%...
    start "" msedge --app="%INDEX_URL%" 2>nul || start "" chrome --app="%INDEX_URL%" 2>nul || start "" "%INDEX_URL%"
    python3 -m http.server %PORT%
    goto end
)

echo [Info] Ouverture directe dans le navigateur par defaut...
start "" "%~dp0index.html"

:end
pause
