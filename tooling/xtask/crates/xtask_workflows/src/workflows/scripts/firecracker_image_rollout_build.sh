# Build the image at the checked-out commit, record each file's SHA-256 and
# size, and publish the files zstd-compressed to the Nix cache bucket under
# firecracker-images/<version>/. A version already published must hold
# exactly these files: versions are immutable. Writes the digests to
# $FILES_DIR/files.json for the roll-out job.
set -euo pipefail

fail() {
  echo "::error::$1"
  exit 1
}

[ "$(git rev-parse HEAD)" = "$SOURCE_SHA" ] || fail "checked out $(git rev-parse HEAD), not $SOURCE_SHA"
[ -e /dev/kvm ] || fail "this runner has no /dev/kvm; the image's disk build needs it"

# s3://<bucket>?region=<region>
[[ "${NIX_CACHE_URL:-}" =~ ^s3://([a-z0-9.-]+)\?(.*&)?region=([a-z0-9-]+) ]] \
  || fail "the NIX_CACHE_URL repository variable is not an s3:// URL with a region"
bucket=${BASH_REMATCH[1]}
export AWS_DEFAULT_REGION=${BASH_REMATCH[3]}
prefix="firecracker-images/$IMAGE_VERSION"

nix build --print-build-logs --out-link result-image .#macro-box-firecracker

mkdir -p "$FILES_DIR"
work=$(mktemp -d)
tools=(--inputs-from . nixpkgs#awscli2 nixpkgs#zstd nixpkgs#jq)

entries=()
for name in vmlinux rootfs.ext4 boot_args; do
  file="result-image/$name"
  sha256=$(sha256sum "$file" | cut -d' ' -f1)
  bytes=$(stat -L -c %s "$file")
  entries+=("{\"name\":\"$name\",\"sha256\":\"$sha256\",\"bytes\":$bytes}")
  echo "$name: $bytes bytes, sha256 $sha256"
done
files=$(IFS=,; echo "[${entries[*]}]")
nix shell "${tools[@]}" -c jq -S . <<<"$files" >"$FILES_DIR/files.json"

if nix shell "${tools[@]}" -c aws s3api head-object --bucket "$bucket" --key "$prefix/files.json" >/dev/null 2>&1; then
  nix shell "${tools[@]}" -c aws s3 cp --only-show-errors "s3://$bucket/$prefix/files.json" "$work/published.json"
  if ! cmp -s <(nix shell "${tools[@]}" -c jq -S . "$work/published.json") "$FILES_DIR/files.json"; then
    echo "published:"; cat "$work/published.json"
    echo "built:"; cat "$FILES_DIR/files.json"
    fail "$IMAGE_VERSION is already published with other files; image versions are immutable"
  fi
  echo "$IMAGE_VERSION is already published with these files"
  exit 0
fi

for name in vmlinux rootfs.ext4 boot_args; do
  nix shell "${tools[@]}" -c zstd -q -T0 -10 --sparse "result-image/$name" -o "$work/$name.zst"
  nix shell "${tools[@]}" -c aws s3 cp --only-show-errors "$work/$name.zst" "s3://$bucket/$prefix/$name.zst"
done
# The digests go last: their presence means the files are complete.
nix shell "${tools[@]}" -c aws s3 cp --only-show-errors "$FILES_DIR/files.json" "s3://$bucket/$prefix/files.json"
echo "published $IMAGE_VERSION to s3://$bucket/$prefix/"
