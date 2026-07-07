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
