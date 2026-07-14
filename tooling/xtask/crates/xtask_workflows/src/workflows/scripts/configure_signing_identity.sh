set -euo pipefail
if [ -z "${MACOS_DEVELOPER_ID_CERTIFICATE_BASE64}" ] || [ -z "${MACOS_DEVELOPER_ID_CERTIFICATE_PASSWORD}" ]; then
  echo "Developer ID certificate secrets are not configured; using ad-hoc signing for build validation."
  echo "APPLE_SIGNING_IDENTITY=-" >> "$GITHUB_ENV"
  exit 0
fi

certificate_path="$RUNNER_TEMP/developer-id-application.p12"
printf '%s' "$MACOS_DEVELOPER_ID_CERTIFICATE_BASE64" | base64 --decode > "$certificate_path" 2>/dev/null \
  || printf '%s' "$MACOS_DEVELOPER_ID_CERTIFICATE_BASE64" | base64 -D > "$certificate_path"

# Nix's macOS daemon builds as _nixbld users, not the runner user.
# Put the Developer ID identity in the system keychain so codesign can
# find it from inside the Nix build without embedding certificate
# secrets into the derivation.
sudo security import "$certificate_path" \
  -k /Library/Keychains/System.keychain \
  -P "$MACOS_DEVELOPER_ID_CERTIFICATE_PASSWORD" \
  -A \
  -T /usr/bin/codesign \
  -T /usr/bin/security
sudo security set-key-partition-list \
  -S apple-tool:,apple:,codesign: \
  -s \
  -k "" \
  /Library/Keychains/System.keychain || true

identity=$(security find-identity -v -p codesigning /Library/Keychains/System.keychain \
  | awk -F '"' '/Developer ID Application/ { print $2; exit }')
if [ -z "$identity" ]; then
  echo "No Developer ID Application identity found in System.keychain" >&2
  security find-identity -v -p codesigning /Library/Keychains/System.keychain >&2 || true
  exit 1
fi
echo "APPLE_SIGNING_IDENTITY=$identity" >> "$GITHUB_ENV"
echo "Using signing identity: $identity"
