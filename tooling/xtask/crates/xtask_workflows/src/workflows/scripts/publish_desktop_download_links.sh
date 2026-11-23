set -euo pipefail

# Fixed-name installer copies on desktop-stable give the website permanent
# download links (macro.com/download/*). They follow the update feed: publish
# them only while desktop-stable serves this release's latest.json, so a
# rerun of an older tag never replaces a newer installer.
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT
gh release download desktop-stable --repo "$RELEASE_REPOSITORY" --pattern latest.json --dir "$work_dir"
if ! cmp -s release-artifacts/latest.json "$work_dir/latest.json"; then
  echo "desktop-stable serves another release; leaving its download links unchanged."
  exit 0
fi
version=$(jq -er '.version' release-artifacts/latest.json)

gh api "repos/$RELEASE_REPOSITORY/releases/tags/desktop-stable" > "$work_dir/channel.json"
release_id=$(jq -er '.id' "$work_dir/channel.json")
list_assets() {
  gh api "repos/$RELEASE_REPOSITORY/releases/$release_id/assets?per_page=100" > "$work_dir/assets.json"
}
asset_field() {
  jq -r --arg name "$1" --arg field "$2" \
    'map(select(.name == $name)) | first | .[$field] // empty' "$work_dir/assets.json"
}

# Versioned installer name, then its fixed name. Keep these in step with
# apps/marketing/seo/download-redirects.json.
installers=(
  "Macro-$version-aarch64-darwin.dmg Macro-macos-arm64.dmg"
  "Macro-$version-x86_64-linux.AppImage Macro-linux-x86_64.AppImage"
)
for installer in "${installers[@]}"; do
  read -r source link <<< "$installer"
  file="release-artifacts/$source"
  if [ ! -f "$file" ]; then
    echo "Missing installer $source" >&2
    exit 1
  fi
  digest="sha256:$(sha256sum "$file" | cut -d' ' -f1)"
  list_assets
  if [ "$(asset_field "$link" digest)" = "$digest" ]; then
    echo "$link already serves $source."
    continue
  fi

  # `gh release upload --clobber` deletes the old asset before uploading, which
  # would break the public link for the whole upload (or for good, if it fails).
  # Upload under a staging name, then swap names in two quick API calls.
  staging="$link.next"
  cp "$file" "$work_dir/$staging"
  gh release upload desktop-stable "$work_dir/$staging" --repo "$RELEASE_REPOSITORY" --clobber
  rm "$work_dir/$staging"
  list_assets
  staging_id=$(asset_field "$staging" id)
  if [ -z "$staging_id" ] || [ "$(asset_field "$staging" size)" != "$(stat -c %s "$file")" ]; then
    echo "Uploaded $staging does not match $source" >&2
    exit 1
  fi
  old_id=$(asset_field "$link" id)
  if [ -n "$old_id" ]; then
    gh api --method DELETE "repos/$RELEASE_REPOSITORY/releases/assets/$old_id"
  fi
  gh api --method PATCH "repos/$RELEASE_REPOSITORY/releases/assets/$staging_id" -f name="$link" > /dev/null
  echo "$link now serves $source."
done

gh release edit desktop-stable --repo "$RELEASE_REPOSITORY" \
  --notes "Update feed and the current desktop installers. Download Macro at https://macro.com/download."
