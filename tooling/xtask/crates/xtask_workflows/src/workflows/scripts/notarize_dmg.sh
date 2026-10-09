set -euo pipefail

if [ -z "${DOPPLER_TOKEN:-}" ]; then
  echo "MACOS_RELEASE_DOPPLER_TOKEN must grant read access to macos-release/prd" >&2
  exit 1
fi
dmg=$(find artifacts -maxdepth 1 -type f -name '*.dmg' -print -quit)
if [ -z "$dmg" ]; then
  echo "No DMG found to notarize" >&2
  exit 1
fi

umask 077
credentials_dir=$(mktemp -d)
trap 'rm -rf "$credentials_dir"' EXIT
curl --fail --silent --show-error --retry 3 \
  --header "Authorization: Bearer $DOPPLER_TOKEN" \
  'https://api.doppler.com/v3/configs/config/secrets/download?project=macos-release&config=prd&format=json&secrets=APPLE_API_PRIVATE_KEY,APPLE_API_KEY_ID,APPLE_API_ISSUER' \
  > "$credentials_dir/secrets.json"
jq -er '.APPLE_API_PRIVATE_KEY | strings | select(length > 0)' \
  "$credentials_dir/secrets.json" > "$credentials_dir/AuthKey.p8"
key_id=$(jq -er '.APPLE_API_KEY_ID | strings | select(length > 0)' "$credentials_dir/secrets.json")
issuer=$(jq -er '.APPLE_API_ISSUER | strings | select(length > 0)' "$credentials_dir/secrets.json")

# Submission failure, rejection, or timeout must prevent publishing this build.
xcrun notarytool submit "$dmg" \
  --key "$credentials_dir/AuthKey.p8" --key-id "$key_id" --issuer "$issuer" \
  --wait --timeout 30m --output-format json > "$credentials_dir/submission.json"
cat "$credentials_dir/submission.json"
jq -e '.status == "Accepted"' "$credentials_dir/submission.json" > /dev/null
xcrun stapler staple "$dmg"
xcrun stapler validate "$dmg"
spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"

# The updater ships the app rather than the DMG. Notarize and staple that exact
# final app too; stapling only the disk image does not staple the updater app.
ditto -c -k --keepParent updater-app/Macro.app "$credentials_dir/updater-app.zip"
xcrun notarytool submit "$credentials_dir/updater-app.zip" \
  --key "$credentials_dir/AuthKey.p8" --key-id "$key_id" --issuer "$issuer" \
  --wait --timeout 30m --output-format json > "$credentials_dir/app-submission.json"
jq -e '.status == "Accepted"' "$credentials_dir/app-submission.json" > /dev/null
xcrun stapler staple updater-app/Macro.app
xcrun stapler validate updater-app/Macro.app
codesign --verify --deep --strict --verbose=2 updater-app/Macro.app
spctl --assess --type execute --verbose=2 updater-app/Macro.app
version=$(jq -er '.version' apps/web/tauri/desktop-release.json)
COPYFILE_DISABLE=1 tar -czf "artifacts/Macro-${version}-aarch64-darwin.app.tar.gz" -C updater-app Macro.app

# Stapling changes the DMG bytes, so checksum the final distributable.
(cd artifacts && shasum -a 256 -- *.dmg > macro-dmg-SHA256SUMS)
