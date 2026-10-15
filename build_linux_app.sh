#!/bin/bash
set -e

# ==============================================================================
# L'antre du caddrillage - Compilateur & Lanceur Linux (.AppImage)
# Fonctionne 100% hors-ligne avec tous les écrits intégrés dans seed_writings.json
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

APP_NAME="lantre-du-caddrillage"
PORT=8080
URL="http://localhost:$PORT/index.html"

echo "========================================================"
echo "  L'antre du caddrillage - Compilateur & Lanceur Linux"
echo "========================================================"
echo "Ce script s'exécute sur un environnement Linux (Ubuntu, Debian, Fedora, Arch)."
echo "Vos textes récents sont directement chargés depuis seed_writings.json."
echo ""

if command -v npx &>/dev/null; then
    echo "[Option] Node.js & npm sont installés sur cette machine Linux."
    read -p "Voulez-vous compiler le paquet universel .AppImage ? (o/N) : " BUILD_CHOICE
    if [[ "$BUILD_CHOICE" =~ ^[oOyY]$ ]]; then
        echo "Compilation de l'AppImage en cours..."
        npx electron-builder --linux AppImage --publish never
        echo "✓ AppImage généré dans dist/ :"
        ls -lh dist/*.AppImage 2>/dev/null || true
        exit 0
    fi
fi

echo "Démarrage du mode autonome local avec tous vos écrits..."
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
    echo "Ouverture directe dans le navigateur par défaut..."
    xdg-open "$SCRIPT_DIR/index.html" 2>/dev/null || sensible-browser "$SCRIPT_DIR/index.html" 2>/dev/null || true
fi
