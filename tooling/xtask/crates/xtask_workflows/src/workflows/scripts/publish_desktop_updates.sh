set -euo pipefail

nix develop --command bun apps/web/scripts/desktop-release.mjs manifest \
  release-artifacts "$RELEASE_TAG" "$RELEASE_REPOSITORY"

# Refuse to overwrite release assets: the manifest may already reference them.
# A failed publication can be resumed if every existing asset has identical bytes.
if ! gh release view "$RELEASE_TAG" --repo "$RELEASE_REPOSITORY" >/dev/null 2>&1; then
  gh release create "$RELEASE_TAG" --repo "$RELEASE_REPOSITORY" --verify-tag \
    --title "Macro $RELEASE_TAG" --notes "Desktop release $RELEASE_TAG" --latest=false
fi
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT
gh release view "$RELEASE_TAG" --repo "$RELEASE_REPOSITORY" --json assets > "$work_dir/release.json"
for file in release-artifacts/*; do
  name=$(basename "$file")
  # The mutable feed is published only after the immutable packages.
  [ "$name" != latest.json ] || continue
  if jq -e --arg name "$name" '.assets | any(.name == $name)' "$work_dir/release.json" >/dev/null; then
    gh release download "$RELEASE_TAG" --repo "$RELEASE_REPOSITORY" --pattern "$name" --dir "$work_dir"
    cmp "$file" "$work_dir/$name"
  else
    gh release upload "$RELEASE_TAG" "$file" --repo "$RELEASE_REPOSITORY"
  fi
done

# A dedicated prerelease hosts only the mutable pointer. It never becomes the
# public download page's latest release, nor follows SDK/daemon release tags.
if gh release view desktop-stable --repo "$RELEASE_REPOSITORY" --json assets > "$work_dir/channel.json"; then
  if jq -e '.assets | any(.name == "latest.json")' "$work_dir/channel.json" >/dev/null; then
    gh release download desktop-stable --repo "$RELEASE_REPOSITORY" --pattern latest.json --dir "$work_dir"
    result=0
    nix develop --command bun apps/web/scripts/desktop-release.mjs newer \
      release-artifacts/latest.json "$work_dir/latest.json" || result=$?
    if [ "$result" -eq 2 ]; then
      echo "A matching or newer desktop release is already promoted."
      exit 0
    fi
    [ "$result" -eq 0 ] || exit "$result"
  fi
else
  # Do not mistake an authentication/network error for an absent release.
  gh api --paginate --slurp "repos/$RELEASE_REPOSITORY/releases" > "$work_dir/releases.json"
  if jq -e '.[][] | select(.tag_name == "desktop-stable")' "$work_dir/releases.json" >/dev/null; then
    echo "Could not read the existing desktop update channel" >&2
    exit 1
  fi
  gh release create desktop-stable --repo "$RELEASE_REPOSITORY" --target "$RELEASE_TAG" \
    --prerelease --latest=false --title "Desktop stable update feed" \
    --notes "Update metadata only. Download installers from a versioned desktop release."
fi
gh release upload desktop-stable release-artifacts/latest.json --repo "$RELEASE_REPOSITORY" --clobber
gh release edit "$RELEASE_TAG" --repo "$RELEASE_REPOSITORY" --latest
