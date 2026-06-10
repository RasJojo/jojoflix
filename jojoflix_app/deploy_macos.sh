#!/bin/bash
set -e

echo "=== Build release Flutter macOS ==="
flutter build macos --release

APP_BUILD="build/macos/Build/Products/Release/jojoflix_app.app"
APP_DEST="/Applications/jojoflix_app.app"

echo "=== Correction des symlinks frameworks ==="
for FW in "$APP_BUILD/Contents/Frameworks/"*.framework; do
  FNAME=$(basename "$FW" .framework)
  VERSIONS="$FW/Versions"
  [ -d "$VERSIONS" ] || continue

  if [ -d "$VERSIONS/Current" ] && [ ! -L "$VERSIONS/Current" ]; then
    rm -rf "$VERSIONS/Current"
    ln -sf A "$VERSIONS/Current"
  fi
  if [ -f "$FW/$FNAME" ] && [ ! -L "$FW/$FNAME" ]; then
    rm -f "$FW/$FNAME"
    ln -sf "Versions/Current/$FNAME" "$FW/$FNAME"
  fi
  if [ -d "$FW/Resources" ] && [ ! -L "$FW/Resources" ]; then
    rm -rf "$FW/Resources"
    ln -sf "Versions/Current/Resources" "$FW/Resources"
  fi
done

echo "=== Re-signature ad-hoc ==="
codesign --force --deep --sign - "$APP_BUILD"

echo "=== Déploiement dans /Applications ==="
rm -rf "$APP_DEST"
cp -r "$APP_BUILD" "$APP_DEST"

echo "=== Lancement ==="
pkill -f "jojoflix_app" 2>/dev/null || true
sleep 1
open "$APP_DEST"
echo "DONE"
