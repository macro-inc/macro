set -euo pipefail
mkdir -p artifacts
shopt -s nullglob
appimages=(result/*.AppImage)
if [ "${#appimages[@]}" -eq 0 ]; then
  echo "No AppImage files found in nix build result" >&2
  find -L result -maxdepth 2 -type f -print >&2 || true
  exit 1
fi
cp -v "${appimages[@]}" artifacts/
chmod 0755 artifacts/*.AppImage
(cd artifacts && sha256sum -- *.AppImage > SHA256SUMS)
