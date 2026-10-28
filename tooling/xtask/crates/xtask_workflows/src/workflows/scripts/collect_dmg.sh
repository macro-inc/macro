set -euo pipefail
mkdir -p artifacts
shopt -s nullglob
dmgs=(result/*.dmg)
if [ "${#dmgs[@]}" -eq 0 ]; then
  echo "No DMG files found in nix build result" >&2
  find -L result -maxdepth 2 -type f -print >&2 || true
  exit 1
fi
cp -v "${dmgs[@]}" artifacts/
# Nix outputs are read-only; stapler must write Apple's ticket into the copy.
chmod u+w artifacts/*.dmg
mkdir -p updater-app
cp -a result/Macro.app updater-app/
chmod -R u+w updater-app/Macro.app
cp apps/web/tauri/desktop-release.json artifacts/darwin-aarch64.release.json
