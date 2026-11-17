#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

APP_NAME="Outline"
BUILT="src-tauri/target/release/bundle/macos/$APP_NAME.app"
DEST="/Applications/$APP_NAME.app"

echo "Building ${APP_NAME}…"
pnpm tauri build

if [ ! -d "$BUILT" ]; then
  echo "Build finished but $BUILT was not found." >&2
  exit 1
fi

if pgrep -xq "$APP_NAME"; then
  echo "Asking $APP_NAME to quit (save your work if prompted)…"
  osascript -e "tell application \"$APP_NAME\" to quit" >/dev/null 2>&1 || true
  i=0
  while pgrep -xq "$APP_NAME"; do
    i=$((i + 1))
    if [ "$i" -ge 120 ]; then
      echo "$APP_NAME is still running. Quit it and run the script again." >&2
      exit 1
    fi
    sleep 0.5
  done
fi

echo "Installing to ${DEST}…"
rm -rf "$DEST"
ditto "$BUILT" "$DEST"
touch "$DEST"

CLI_SRC="$DEST/Contents/Resources/outline"
CLI_DIR="$HOME/.local/bin"
if [ -f "$CLI_SRC" ]; then
  mkdir -p "$CLI_DIR"
  ln -sfn "$CLI_SRC" "$CLI_DIR/outline"
  echo "Linked the outline command to $CLI_DIR/outline"
  case ":$PATH:" in
    *":$CLI_DIR:"*) ;;
    *) echo "Note: $CLI_DIR is not on your PATH. Add it to use 'outline' from the terminal." ;;
  esac
fi

echo "Opening ${APP_NAME}…"
open "$DEST"
echo "Done."
