set -euo pipefail
# Namespace macOS images install several Xcodes side by side under
# /Applications and select one by default, which moves when the image adds a
# newer Xcode. Find $XCODE_VERSION (any patch release, never a beta) by the
# version each bundle reports, and select it for every later step: the iOS
# toolchain split (ios-native-env.sh, build_ios_simulator_app.sh) reads
# `xcode-select -p` because nix develop overrides DEVELOPER_DIR.
#
# An image-level DEVELOPER_DIR would outrank that selection for xcodebuild,
# xcrun and `xcode-select -p` alike, so drop it here and pin it for later steps.
unset DEVELOPER_DIR
plist_value() {
  /usr/libexec/PlistBuddy -c "Print :$2" "$1/Contents/version.plist" 2>/dev/null
}

installed=""
best=""
best_version=""
best_patch=-1
for app in /Applications/Xcode*.app; do
  [[ -f "$app/Contents/version.plist" ]] || continue
  version=$(plist_value "$app" CFBundleShortVersionString) || continue
  build=$(plist_value "$app" ProductBuildVersion) || build="?"
  installed+="  $app: Xcode $version ($build)"$'\n'
  [[ "$app" == *[Bb]eta* ]] && continue
  [[ "$version" == "$XCODE_VERSION" || "$version" == "$XCODE_VERSION".* ]] || continue
  # Prefer the newest patch release: 27.1.1 over 27.1.
  patch=${version#"$XCODE_VERSION"}
  patch=${patch#.}
  if (( ${patch:-0} > best_patch )); then
    best="$app"
    best_version="$version"
    best_patch=${patch:-0}
  fi
done

if [[ -z "$best" ]]; then
  echo "::error::This runner has no Xcode ${XCODE_VERSION}; iOS builds need it for the iOS ${XCODE_VERSION} SDK. Move the job to a runner image that ships it (see runners.rs) or change the pinned version in steps.rs."
  echo "Installed Xcodes:"
  printf '%s' "${installed:-  none}"
  exit 1
fi

echo "Installed Xcodes:"
printf '%s' "$installed"
echo "Selecting $best (Xcode $best_version)."
sudo xcode-select --switch "$best/Contents/Developer"
echo "DEVELOPER_DIR=$best/Contents/Developer" >> "$GITHUB_ENV"
# Installs the system components a non-default Xcode may still lack; a no-op
# once they match.
sudo xcodebuild -runFirstLaunch

xcodebuild -version
for sdk in iphoneos iphonesimulator; do
  sdk_version=$(xcrun --sdk "$sdk" --show-sdk-version 2>/dev/null || true)
  if [[ "$sdk_version" != "$XCODE_VERSION" && "$sdk_version" != "$XCODE_VERSION".* ]]; then
    echo "::error::Xcode ${best_version} at $best has the ${sdk} SDK '${sdk_version:-missing}', not ${XCODE_VERSION}."
    xcodebuild -showsdks || true
    exit 1
  fi
  echo "${sdk} SDK ${sdk_version}"
done
