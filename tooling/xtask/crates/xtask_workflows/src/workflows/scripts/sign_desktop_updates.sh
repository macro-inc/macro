set -euo pipefail

# All private material stays on the ephemeral runner, outside Nix derivations.
umask 077
credentials_dir=$(mktemp -d)
trap 'rm -rf "$credentials_dir"' EXIT
curl --fail --silent --show-error --retry 3 \
  --header "Authorization: Bearer $DOPPLER_TOKEN" \
  'https://api.doppler.com/v3/configs/config/secrets/download?project=macos-release&config=prd&format=json&secrets=TAURI_SIGNING_PRIVATE_KEY,TAURI_SIGNING_PRIVATE_KEY_PASSWORD' \
  > "$credentials_dir/secrets.json"
# The Tauri signer rejects the newline that jq normally appends to raw output.
jq -jer '.TAURI_SIGNING_PRIVATE_KEY | strings | select(length > 0)' \
  "$credentials_dir/secrets.json" > "$credentials_dir/updater.key"
export TAURI_SIGNING_PRIVATE_KEY_PATH="$credentials_dir/updater.key"
TAURI_SIGNING_PRIVATE_KEY_PASSWORD=$(jq -r '.TAURI_SIGNING_PRIVATE_KEY_PASSWORD // ""' "$credentials_dir/secrets.json")
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD

# Verify against the public key compiled into EVERY package before publishing.
# macOS and Linux ship with each release; Windows only once its build is signed
# and released, so its metadata may be absent.
targets=(darwin-aarch64 linux-x86_64)
if [ -e release-artifacts/windows-x86_64.release.json ]; then
  targets+=(windows-x86_64)
fi
for target in "${targets[@]}"; do
  jq -er '.publicKey | select(length > 0)' "release-artifacts/$target.release.json" > "$credentials_dir/$target.pub"
  cmp "$credentials_dir/darwin-aarch64.pub" "$credentials_dir/$target.pub"
done
base64 --decode "$credentials_dir/darwin-aarch64.pub" > "$credentials_dir/minisign.pub"
if ! gh release view "$RELEASE_TAG" --repo "$RELEASE_REPOSITORY" --json assets > "$credentials_dir/release.json"; then
  # Reading the collection must succeed before treating the version as absent.
  gh api --paginate --slurp "repos/$RELEASE_REPOSITORY/releases" > "$credentials_dir/releases.json"
  if jq -e --arg tag "$RELEASE_TAG" '.[][] | select(.tag_name == $tag)' "$credentials_dir/releases.json" >/dev/null; then
    echo "Could not inspect existing release assets" >&2
    exit 1
  fi
  printf '{"assets":[]}' > "$credentials_dir/release.json"
fi
shopt -s nullglob
artifacts=(release-artifacts/*.app.tar.gz release-artifacts/*.AppImage release-artifacts/*-windows-setup.exe)
if [ "${#artifacts[@]}" -ne "${#targets[@]}" ]; then
  echo "Expected one updater artifact for each of: ${targets[*]}" >&2
  exit 1
fi
for artifact in "${artifacts[@]}"; do
  name=$(basename "$artifact")
  if jq -e --arg name "$name.sig" '.assets | any(.name == $name)' "$credentials_dir/release.json" >/dev/null; then
    # Signatures include signing time. Reuse a previously published signature
    # only after checking both the immutable package bytes and its signature.
    gh release download "$RELEASE_TAG" --repo "$RELEASE_REPOSITORY" --pattern "$name" --pattern "$name.sig" --dir "$credentials_dir"
    cmp "$artifact" "$credentials_dir/$name"
    cp "$credentials_dir/$name.sig" "$artifact.sig"
  else
    nix shell --inputs-from . nixpkgs#cargo-tauri --command cargo-tauri signer sign "$artifact"
  fi
  base64 --decode "$artifact.sig" > "$credentials_dir/artifact.minisig"
  nix shell --inputs-from . nixpkgs#minisign --command minisign \
    -Vm "$artifact" -p "$credentials_dir/minisign.pub" -x "$credentials_dir/artifact.minisig"
done
