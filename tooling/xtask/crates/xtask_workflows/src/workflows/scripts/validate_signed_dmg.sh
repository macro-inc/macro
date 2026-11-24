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

# macOS refuses to open the app below LSMinimumSystemVersion. It must be the
# CEF config's minimum, and no lower than the newest macOS any binary in the
# bundle was built for (its minos), since dyld won't load a library built for
# a newer macOS than the one running.
version_below() {
  awk -v a="$1" -v b="$2" 'BEGIN {
    split(a, x, "."); split(b, y, ".")
    for (i = 1; i <= 3; i++) if (x[i] + 0 != y[i] + 0) exit !(x[i] + 0 < y[i] + 0)
    exit 1
  }'
}
expected_minimum=$(jq -er '.bundle.macOS.minimumSystemVersion' apps/web/tauri/desktop-cef/tauri.conf.json)
app_minimum=$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$app/Contents/Info.plist")
if [ "$app_minimum" != "$expected_minimum" ]; then
  echo "Info.plist LSMinimumSystemVersion is $app_minimum, expected $expected_minimum" >&2
  exit 1
fi
binary_minimum() {
  otool -l "$1" 2>/dev/null | awk '
    $1 == "cmd" { cmd = $2 }
    cmd == "LC_BUILD_VERSION" && $1 == "minos" { print $2; exit }
    cmd == "LC_VERSION_MIN_MACOSX" && $1 == "version" { print $2; exit }
  ' || true
}
highest_minimum=""
highest_binary=""
while IFS= read -r -d '' file; do
  minimum=$(binary_minimum "$file")
  if [ -n "$minimum" ] && { [ -z "$highest_minimum" ] || version_below "$highest_minimum" "$minimum"; }; then
    highest_minimum=$minimum
    highest_binary=$file
  fi
done < <(find "$app" -type f -print0)
if [ -z "$(binary_minimum "$framework/Chromium Embedded Framework")" ]; then
  echo "Could not read the minimum macOS of the app's binaries" >&2
  exit 1
fi
if version_below "$app_minimum" "$highest_minimum"; then
  echo "${highest_binary#"$app/"} needs macOS $highest_minimum; raise bundle.macOS.minimumSystemVersion in apps/web/tauri/desktop-cef/tauri.conf.json from $app_minimum" >&2
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
