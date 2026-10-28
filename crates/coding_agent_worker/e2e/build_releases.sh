#!/usr/bin/env bash
# Build macrod twice from this checkout, as two release tags, and package each
# the way the release workflow does: macrod-<tag>-<os>-<arch>.tar.gz plus its
# .sha256. A debug build is enough to exercise the updater.
#
#   build_releases.sh OUT_DIR V1_TAG V2_TAG
set -euo pipefail

out=$1
shift
mkdir -p "$out"
case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=macos ;;
  *) echo "unsupported OS" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x86_64 ;;
  arm64 | aarch64) arch=aarch64 ;;
esac
target_dir=$(cargo metadata --format-version 1 --no-deps | python3 -c 'import json,sys; print(json.load(sys.stdin)["target_directory"])')

for tag in "$@"; do
  MACROD_RELEASE_TAG="$tag" cargo build -p coding_agent_worker --bin macrod
  stage=$(mktemp -d)
  install -m 755 "$target_dir/debug/macrod" "$stage/macrod"
  "$stage/macrod" --version | grep -qF "$tag"
  archive="macrod-$tag-$os-$arch.tar.gz"
  tar -czf "$out/$archive" -C "$stage" macrod
  (
    cd "$out"
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$archive"; else shasum -a 256 "$archive"; fi >"$archive.sha256"
  )
  rm -rf "$stage"
  echo "packaged $out/$archive"
done
