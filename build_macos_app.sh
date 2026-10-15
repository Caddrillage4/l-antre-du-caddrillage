#!/bin/bash
set -e

# ==============================================================================
# Script de compilation & packaging de L'antre du caddrillage pour macOS
# Architecture : Apple Silicon (arm64) & Universal
# Génère : L'antre du caddrillage.app et L'antre du caddrillage.dmg
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

APP_NAME="L'antre du caddrillage"
BUNDLE_ID="com.caddrillage.lantre"
APP_DIR="$APP_NAME.app"
DMG_FILE="$APP_NAME.dmg"
STAGING_DIR="build_dmg_staging"

echo "============================================================"
echo "  Construction de l'application macOS : $APP_NAME"
echo "============================================================"

# 1. Nettoyage des précédents builds
echo "1. Nettoyage des anciens fichiers de build..."
rm -rf "$APP_DIR" "$DMG_FILE" "$STAGING_DIR" "test.dmg" "test_sym.dmg" "temp_hybrid.dmg"

# 2. Création de l'arborescence du Bundle macOS
echo "2. Création du bundle $APP_DIR..."
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

# 3. Création du fichier Info.plist
echo "3. Génération de Info.plist..."
cat << 'EOF' > "$APP_DIR/Contents/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>L'antre du caddrillage</string>
    <key>CFBundleIdentifier</key>
    <string>com.caddrillage.lantre</string>
    <key>CFBundleName</key>
    <string>L'antre du caddrillage</string>
    <key>CFBundleDisplayName</key>
    <string>L'antre du caddrillage</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>LSMinimumSystemVersion</key>
    <string>11.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSRequiresAquaSystemAppearance</key>
    <false/>
    <key>NSSupportsAutomaticGraphicsSwitching</key>
    <true/>
</dict>
</plist>
EOF

# 4. Copie de l'icône de l'application
if [ -f "AppIcon.icns" ]; then
    echo "4. Copie de l'icône AppIcon.icns..."
    cp "AppIcon.icns" "$APP_DIR/Contents/Resources/AppIcon.icns"
fi

# 5. Copie des ressources web & bibliothèques autonomes
echo "5. Intégration des fichiers web et bibliothèques hors-ligne..."
cp index.html "$APP_DIR/Contents/Resources/"
cp style.css "$APP_DIR/Contents/Resources/"
cp app.js "$APP_DIR/Contents/Resources/"

# Copie des bibliothèques locales
if [ -d "libs" ]; then
    cp -R libs "$APP_DIR/Contents/Resources/"
fi

# Copie des images (thèmes, fonds, icônes)
cp *.jpg *.jpeg *.png "$APP_DIR/Contents/Resources/" 2>/dev/null || true

# 6. Compilation du wrapper natif Cocoa + WebKit (Objective-C)
echo "6. Compilation du binaire natif macOS avec clang..."
mkdir -p .module_cache
clang -fmodules -fmodules-cache-path=./.module_cache \
      -framework Cocoa -framework WebKit \
      -O2 \
      macos_app/main.m \
      -o "$APP_DIR/Contents/MacOS/$APP_NAME"

chmod +x "$APP_DIR/Contents/MacOS/$APP_NAME"

# 7. Nettoyage des métadonnées étendues & Signature ad-hoc (Gatekeeper)
echo "7. Signature du bundle d'application..."
xattr -cr "$APP_DIR"
codesign --force --deep -s - "$APP_DIR"

echo "✓ Application créée avec succès : $APP_DIR"

# 8. Création de l'image disque .dmg installateur
echo "8. Génération du disque d'installation ($DMG_FILE)..."
mkdir -p "$STAGING_DIR"
cp -R "$APP_DIR" "$STAGING_DIR/"
ln -s /Applications "$STAGING_DIR/Applications"
xattr -cr "$STAGING_DIR" 2>/dev/null || true

rm -f "temp_hybrid.dmg" "$DMG_FILE"
hdiutil makehybrid -hfs -hfs-volume-name "$APP_NAME" -o "temp_hybrid.dmg" "$STAGING_DIR"
hdiutil convert "temp_hybrid.dmg" -format UDZO -o "$DMG_FILE"
rm -f "temp_hybrid.dmg"
rm -rf "$STAGING_DIR"

echo "============================================================"
echo "  SUCCÈS ! L'application macOS est prête :"
echo "  - Application directe : $PWD/$APP_DIR"
echo "  - Installateur DMG    : $PWD/$DMG_FILE"
echo "============================================================"
ls -lh "$APP_DIR" "$DMG_FILE"
