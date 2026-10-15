#!/bin/bash
set -e

# ==============================================================================
# Script de compilation / lancement pour Linux (.AppImage / WebKitGTK)
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

APP_NAME="lantre-du-caddrillage"
PORT=8080
URL="http://localhost:$PORT/index.html"

echo "========================================================"
echo "  L'antre du caddrillage - Lanceur Linux"
echo "========================================================"

if command -v python3 &>/dev/null; then
    echo "Démarrage du serveur local sur le port $PORT..."
    python3 -m http.server $PORT &
    SERVER_PID=$!
    sleep 1

    if command -v xdg-open &>/dev/null; then
        xdg-open "$URL"
    elif command -v google-chrome &>/dev/null; then
        google-chrome --app="$URL"
    elif command -v firefox &>/dev/null; then
        firefox "$URL"
    fi

    echo "Application active. Appuyez sur Ctrl+C pour arrêter."
    wait $SERVER_PID
else
    echo "Ouverture directe..."
    xdg-open "$SCRIPT_DIR/index.html"
fi
