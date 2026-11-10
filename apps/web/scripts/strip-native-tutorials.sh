#!/usr/bin/env bash
# Remove the tutorial videos and posters from a build that ships inside the
# native apps: the iOS and Android builds (`just build-tauri`) and the
# over-the-air archive (`infra/stacks/web-app`). The iOS and Android apps show
# no tutorials, and the desktop app streams them from the web deploy, which
# keeps them. Vite puts them in this folder (scripts/tutorial-assets.ts).
set -euo pipefail

dist="${1:?expected a build directory}"
if [ ! -f "$dist/index.html" ]; then
  echo "no index.html under $dist; refusing to strip" >&2
  exit 1
fi
rm -rf "$dist/assets/tutorials"
