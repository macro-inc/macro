set -euo pipefail
# Fetch the App Store Connect credentials from Doppler (ios-release/prd) —
# the same shape as the DMG workflow's notarization step — and hand them to
# later steps the way the iOS scripts expect them:
#   APPLE_API_KEY / APPLE_API_ISSUER            exported via GITHUB_ENV
#   ~/.appstoreconnect/private_keys/AuthKey_<ID>.p8   the private key, where
#     altool, tauri (APPLE_API_KEY_PATH default) and ios-app-store.mjs look
# With IOS_DISTRIBUTION_CERTIFICATE=1 the optional Apple Distribution .p12 is
# decoded to $RUNNER_TEMP and exported as APPLE_DISTRIBUTION_CERTIFICATE_PATH
# / _PASSWORD for the signing step.
if [ -z "${DOPPLER_TOKEN:-}" ]; then
  echo "DOPPLER_TOKEN is empty: the IOS_RELEASE_DOPPLER_TOKEN secret is missing, or this is a fork PR (secrets are not available to forks; a maintainer must run the release from a branch in this repository, or add skip-ios-update if the change is non-breaking)." >&2
  exit 1
fi

umask 077
secrets=$(mktemp)
trap 'rm -f "$secrets"' EXIT
curl --fail --silent --show-error --retry 3 \
  --header "Authorization: Bearer $DOPPLER_TOKEN" \
  'https://api.doppler.com/v3/configs/config/secrets/download?project=ios-release&config=prd&format=json' \
  > "$secrets"

required() {
  jq -er --arg name "$1" '.[$name] | strings | select(length > 0)' "$secrets" \
    || { echo "ios-release/prd is missing $1" >&2; exit 1; }
}
key_id=$(required APPLE_API_KEY_ID)
issuer=$(required APPLE_API_ISSUER)

key_dir="$HOME/.appstoreconnect/private_keys"
mkdir -p "$key_dir"
key_path="$key_dir/AuthKey_${key_id}.p8"
required APPLE_API_PRIVATE_KEY > "$key_path"
echo "::add-mask::$issuer"
{
  echo "APPLE_API_KEY=$key_id"
  echo "APPLE_API_ISSUER=$issuer"
} >> "$GITHUB_ENV"
echo "Wrote App Store Connect API key $key_id to $key_path"

if [ "${IOS_DISTRIBUTION_CERTIFICATE:-}" = "1" ]; then
  certificate=$(jq -r '.APPLE_DISTRIBUTION_CERTIFICATE_BASE64 // empty' "$secrets")
  if [ -z "$certificate" ]; then
    echo "No APPLE_DISTRIBUTION_CERTIFICATE_BASE64 in ios-release/prd; the build will" \
      "rely on Xcode cloud signing via the API key."
    exit 0
  fi
  certificate_path="$RUNNER_TEMP/apple-distribution.p12"
  printf '%s' "$certificate" | base64 --decode > "$certificate_path" 2>/dev/null \
    || printf '%s' "$certificate" | base64 -D > "$certificate_path"
  password=$(jq -r '.APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD // empty' "$secrets")
  [ -z "$password" ] || echo "::add-mask::$password"
  {
    echo "APPLE_DISTRIBUTION_CERTIFICATE_PATH=$certificate_path"
    echo "APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD=$password"
  } >> "$GITHUB_ENV"
  echo "Wrote Apple Distribution certificate to $certificate_path"
fi
