set -euo pipefail
# The credentials step decodes the optional .p12 from Doppler and exports its
# path; without one, xcodebuild uses cloud signing through the API key
# (-allowProvisioningUpdates).
certificate_path="${APPLE_DISTRIBUTION_CERTIFICATE_PATH:-}"
if [ -z "$certificate_path" ]; then
  echo "No Apple Distribution certificate; relying on Xcode cloud signing" \
    "via the App Store Connect API key."
  exit 0
fi

# Mirror configure_signing_identity.sh (DMG builds): the System keychain keeps
# the identity visible to xcodebuild without per-user keychain unlocking.
sudo security import "$certificate_path" \
  -k /Library/Keychains/System.keychain \
  -P "${APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD:-}" \
  -A \
  -T /usr/bin/codesign \
  -T /usr/bin/security
sudo security set-key-partition-list \
  -S apple-tool:,apple:,codesign: \
  -s \
  -k "" \
  /Library/Keychains/System.keychain || true

identity=$(security find-identity -v -p codesigning /Library/Keychains/System.keychain \
  | awk -F '"' '/Apple Distribution/ { print $2; exit }')
if [ -z "$identity" ]; then
  echo "No Apple Distribution identity found in System.keychain after import" >&2
  security find-identity -v -p codesigning /Library/Keychains/System.keychain >&2 || true
  exit 1
fi
echo "Using signing identity: $identity"
