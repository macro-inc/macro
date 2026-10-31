set -euo pipefail
dmg=$(find artifacts -maxdepth 1 -type f -name '*.dmg' -print -quit)
if [ -z "$dmg" ]; then
  echo "No DMG found to validate" >&2
  exit 1
fi
codesign --verify --strict --verbose=2 "$dmg"

mount_dir=$(mktemp -d)
hdiutil attach -readonly -nobrowse -mountpoint "$mount_dir" "$dmg"
trap 'hdiutil detach "$mount_dir" >/dev/null 2>&1 || true; rmdir "$mount_dir" >/dev/null 2>&1 || true' EXIT
app=$(find "$mount_dir" -maxdepth 2 -type d -name '*.app' -print -quit)
if [ -z "$app" ] && [ -d "$mount_dir/Contents" ]; then
  app="$mount_dir"
fi
if [ -z "$app" ]; then
  echo "No app bundle found in DMG" >&2
  find "$mount_dir" -maxdepth 2 -print >&2 || true
  exit 1
fi
codesign --verify --deep --strict --verbose=2 "$app"

framework="$app/Contents/Frameworks/Chromium Embedded Framework.framework"
if [ ! -s "$framework/Chromium Embedded Framework" ]; then
  echo "Signed DMG is missing the Chromium framework" >&2
  exit 1
fi
helpers=("$app"/Contents/Frameworks/*.app)
if [ "${#helpers[@]}" -lt 5 ]; then
  echo "Signed DMG is missing Chromium helper apps" >&2
  exit 1
fi

check_cef_entitlements() {
  local bundle="$1"
  local entitlements
  entitlements=$(mktemp)
  codesign -d --entitlements :- "$bundle" > "$entitlements" 2>/dev/null
  for key in \
    com.apple.security.cs.allow-jit \
    com.apple.security.cs.allow-unsigned-executable-memory \
    com.apple.security.cs.disable-library-validation; do
    if [ "$(/usr/libexec/PlistBuddy -c "Print :$key" "$entitlements")" != true ]; then
      echo "$bundle is missing the $key entitlement" >&2
      exit 1
    fi
  done
  rm "$entitlements"
}
check_cef_entitlements "$app"
for helper in "${helpers[@]}"; do
  check_cef_entitlements "$helper"
done

dylib_refs=$(mktemp)
search_roots=("$app/Contents/MacOS")
if [ -d "$app/Contents/Frameworks" ]; then
  search_roots+=("$app/Contents/Frameworks")
fi
while IFS= read -r -d '' file; do
  otool -L "$file" 2>/dev/null \
    | awk -v file="$file" 'NR > 1 && $1 ~ "^/nix/store/.*\\.dylib$" { print file ": " $1 }' \
    >> "$dylib_refs" || true
done < <(find "${search_roots[@]}" -type f -print0)
if [ -s "$dylib_refs" ]; then
  echo "App bundle contains absolute Nix dylib references:" >&2
  cat "$dylib_refs" >&2
  exit 1
fi
