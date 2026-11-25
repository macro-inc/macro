set -euo pipefail

# The signed, notarized DMG build-dmg uploaded, opened the way a user opens it:
# mount it and copy the app out. ditto keeps the signature, the stapled ticket
# and the bundle's extended attributes intact.
dmg=$(find "$QA_DMG_DIR" -maxdepth 1 -type f -name '*.dmg' -print -quit)
if [ -z "$dmg" ]; then
  echo "::error::no DMG in the macro-dmg artifact" >&2
  find "$QA_DMG_DIR" -maxdepth 2 -print >&2 || true
  exit 1
fi
echo "Testing $(basename "$dmg")"
echo "QA_DMG=$(cd "$(dirname "$dmg")" && pwd)/$(basename "$dmg")" >> "$GITHUB_ENV"

mount_dir=$(mktemp -d)
hdiutil attach -readonly -nobrowse -mountpoint "$mount_dir" "$dmg"
trap 'hdiutil detach "$mount_dir" >/dev/null 2>&1 || true; rmdir "$mount_dir" >/dev/null 2>&1 || true' EXIT
mounted_app=$(find "$mount_dir" -maxdepth 1 -type d -name '*.app' -print -quit)
if [ -z "$mounted_app" ]; then
  echo "::error::no app bundle in $(basename "$dmg")" >&2
  find "$mount_dir" -maxdepth 2 -print >&2 || true
  exit 1
fi

app_dir="$RUNNER_TEMP/macro-qa"
rm -rf "$app_dir"
mkdir -p "$app_dir"
ditto "$mounted_app" "$app_dir/$(basename "$mounted_app")"
echo "QA_APP=$app_dir/$(basename "$mounted_app")" >> "$GITHUB_ENV"
du -sh "$app_dir/$(basename "$mounted_app")"
