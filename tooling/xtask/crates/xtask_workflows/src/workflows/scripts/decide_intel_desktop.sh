set -euo pipefail

# Whether this run builds the Intel Mac app. Intel Macs ship only with the CEF
# build that plays H.264, HEVC and AAC, so a release tag builds it once
# cef-codecs.json pins that build's sha256 at the tag. Any other ref builds it
# regardless: those runs only verify the build and never publish it.
case "$BUILD_REF" in
  refs/tags/*) ;;
  *)
    echo "intel=true" >> "$GITHUB_OUTPUT"
    exit 0
    ;;
esac

manifest_path=apps/web/tauri/desktop-cef/cef-codecs.json
# Each read has a deadline: the Apple silicon and Linux builds wait for this
# step, and gh api has none of its own.
read_manifest() {
  timeout "${READ_TIMEOUT_SECONDS:-60}" gh api -H 'Accept: application/vnd.github.raw+json' \
    "repos/$GITHUB_REPOSITORY/contents/$manifest_path?ref=$BUILD_REF"
}
# An unreadable manifest skips Intel rather than failing the release: the Apple
# silicon and Linux builds must not wait on the Intel one.
attempt=1
until manifest=$(read_manifest); do
  if [ "$attempt" -ge "${READ_ATTEMPTS:-3}" ]; then
    echo "::warning::Could not read $manifest_path at $BUILD_REF; skipping the Intel Mac build"
    echo "intel=false" >> "$GITHUB_OUTPUT"
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep "${READ_RETRY_SECONDS:-10}"
done
sha256=$(jq -r '.assets.x86_64.sha256 // ""' <<< "$manifest" 2>/dev/null || true)
if [ -z "$sha256" ]; then
  echo "::notice::$manifest_path pins no x86_64 CEF codec build at $BUILD_REF; skipping the Intel Mac build"
  echo "intel=false" >> "$GITHUB_OUTPUT"
  exit 0
fi
echo "intel=true" >> "$GITHUB_OUTPUT"
