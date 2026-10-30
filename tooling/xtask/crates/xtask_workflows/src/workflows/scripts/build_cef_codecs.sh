set -euo pipefail

# Builds the CEF minimal distribution named in cef-codecs.json with H.264,
# HEVC, and AAC decoders, and publishes it as a prerelease asset. The CEF CDN
# builds leave those codecs out, so the macOS app could not play most videos.
manifest=apps/web/tauri/desktop-cef/cef-codecs.json
cef_version=$(jq -er .cefVersion "$manifest")
cef_commit=$(jq -er .cefCommit "$manifest")
chromium_branch=$(jq -er .chromiumBranch "$manifest")
release_tag=$(jq -er .releaseTag "$manifest")
asset=$(jq -er .asset "$manifest")

if gh release view "$release_tag" --repo "$GITHUB_REPOSITORY" --json assets --jq '.assets[].name' 2>/dev/null |
  grep -qxF "$asset"; then
  echo "$release_tag already has $asset; nothing to build."
  exit 0
fi

if [ "$(uname -m)" != "arm64" ]; then
  echo "CEF codec builds must run on an arm64 runner, got $(uname -m)" >&2
  exit 1
fi

work="$RUNNER_TEMP/cef"
mkdir -p "$work"
df -h "$work"
free_gb=$(df -g "$work" | awk 'NR==2 {print $4}')
if [ "$free_gb" -lt 120 ]; then
  echo "Need at least 120 GB free to check out and build Chromium; $work has ${free_gb} GB." >&2
  exit 1
fi

xcode=$(find /Applications -maxdepth 1 -name 'Xcode*.app' | sort -V | tail -1)
sudo xcode-select -s "$xcode/Contents/Developer"
xcodebuild -version

curl -fsSL --retry 5 \
  "https://raw.githubusercontent.com/chromiumembedded/cef/$chromium_branch/tools/automate/automate-git.py" \
  -o "$work/automate-git.py"

export GN_DEFINES="is_official_build=true proprietary_codecs=true ffmpeg_branding=Chrome chrome_pgo_phase=0 symbol_level=0"
export CEF_ARCHIVE_FORMAT=tar.bz2
python3 "$work/automate-git.py" \
  --download-dir="$work/code" \
  --depot-tools-dir="$work/depot_tools" \
  --branch="$chromium_branch" \
  --checkout="$cef_commit" \
  --arm64-build \
  --no-debug-build \
  --minimal-distrib-only \
  --no-distrib-docs \
  --no-chromium-history \
  --build-target=cefsimple

distrib="$work/code/chromium/src/cef/binary_distrib"
built="$distrib/cef_binary_${cef_version}_macosarm64_minimal.tar.bz2"
if [ ! -f "$built" ]; then
  echo "Expected $built; the CEF checkout produced:" >&2
  ls -la "$distrib" >&2
  exit 1
fi

gn_args="$work/code/chromium/src/out/Release_GN_arm64/args.gn"
# args.gn has no spaces around '='; tolerate either form.
for arg in 'proprietary_codecs *= *true' 'ffmpeg_branding *= *"Chrome"'; do
  if ! grep -qE "^$arg$" "$gn_args"; then
    echo "Release build is missing '$arg' in $gn_args" >&2
    cat "$gn_args" >&2
    exit 1
  fi
done

mkdir -p "$RUNNER_TEMP/out"
cp "$built" "$RUNNER_TEMP/out/$asset"
sha256=$(shasum -a 256 "$RUNNER_TEMP/out/$asset" | awk '{print $1}')

if ! gh release view "$release_tag" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
  gh release create "$release_tag" --repo "$GITHUB_REPOSITORY" \
    --target "$TARGET_SHA" --prerelease --latest=false \
    --title "CEF $cef_version with proprietary codecs (macOS arm64)" \
    --notes "Minimal CEF distribution for the macOS desktop app, built with proprietary_codecs=true and ffmpeg_branding=Chrome. sha256: $sha256"
fi
gh release upload "$release_tag" "$RUNNER_TEMP/out/$asset" --repo "$GITHUB_REPOSITORY"

{
  echo "### CEF with proprietary codecs"
  echo
  echo "- Release: \`$release_tag\`"
  echo "- Asset: \`$asset\`"
  echo "- sha256: \`$sha256\`"
  echo
  echo "Set \`sha256\` in \`$manifest\` to this value."
} >> "$GITHUB_STEP_SUMMARY"
