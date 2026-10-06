set -euo pipefail

roots_file="$RUNNER_TEMP/desktop-cache-roots"
if [ ! -s "$roots_file" ]; then
  exit 0
fi

# A DMG's runtime closure omits build-only inputs such as Cargo artifacts and
# the toolchain. Walk its derivation closure and include every existing output,
# including successful dependencies of an otherwise failed build.
while IFS= read -r derivation; do
  nix-store --query --requisites --include-outputs "$derivation"
done < "$roots_file" |
  awk '!/\.drv$/' |
  sort -u |
  nix copy --stdin --to "$DESKTOP_NIX_CACHE_URL"
