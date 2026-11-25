# Build the image at the checked-out commit, record each file's SHA-256 and
# size, and publish the files zstd-compressed to the Nix cache bucket under
# firecracker-images/<version>/<sha256>-<name>.zst. A version already
# published must hold exactly these files: versions are immutable. Writes
# the digests to $FILES_DIR/files.json for the roll-out job.
set -euo pipefail

fail() {
  echo "::error::$1"
  exit 1
}

[ "$(git rev-parse HEAD)" = "$SOURCE_SHA" ] || fail "checked out $(git rev-parse HEAD), not $SOURCE_SHA"
[ -e "${KVM_DEVICE:-/dev/kvm}" ] || fail "this runner has no /dev/kvm; the image's disk build needs it"

# s3://<bucket>?region=<region>
[[ "${NIX_CACHE_URL:-}" =~ ^s3://([a-z0-9.-]+)\?(.*&)?region=([a-z0-9-]+) ]] \
  || fail "the NIX_CACHE_URL repository variable is not an s3:// URL with a region"
bucket=${BASH_REMATCH[1]}
export AWS_DEFAULT_REGION=${BASH_REMATCH[3]}
prefix="firecracker-images/$IMAGE_VERSION"

nix build --print-build-logs --out-link result-image .#macro-box-firecracker

mkdir -p "$FILES_DIR"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
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

# Name each object with the SHA-256 of the uncompressed file. A retry can
# upload the same file to the same key. Commit the version by conditionally
# creating files.json after all uploads complete. The deploy key can't list
# the bucket, so S3 responds with 403 even when the manifest is missing.
aws_error() {
  # Plainly, outside a workflow command, so a multi-line error is kept.
  echo "AWS said:"
  cat "$work/aws.err"
}
for name in vmlinux rootfs.ext4 boot_args; do
  # shellcheck disable=SC2016 # $name is jq's, not the shell's
  sha256=$(nix shell "${tools[@]}" -c jq -r --arg name "$name" '.[] | select(.name == $name) | .sha256' "$FILES_DIR/files.json")
  nix shell "${tools[@]}" -c zstd -q -T0 -10 --sparse "result-image/$name" -o "$work/$name.zst"
  if ! nix shell "${tools[@]}" -c aws s3 cp --only-show-errors "$work/$name.zst" \
    "s3://$bucket/$prefix/$sha256-$name.zst" 2>"$work/aws.err"; then
    aws_error
    fail "uploading $name failed"
  fi
done
if nix shell "${tools[@]}" -c aws s3api put-object --bucket "$bucket" --key "$prefix/files.json" \
  --body "$FILES_DIR/files.json" --if-none-match '*' >/dev/null 2>"$work/aws.err"; then
  echo "published $IMAGE_VERSION to s3://$bucket/$prefix/"
  exit 0
fi
grep -q 'PreconditionFailed\|(412)' "$work/aws.err" || { aws_error; fail "publishing $IMAGE_VERSION failed"; }
# Published before: it must hold exactly these files.
if ! nix shell "${tools[@]}" -c aws s3 cp --only-show-errors "s3://$bucket/$prefix/files.json" \
  "$work/published.json" 2>"$work/aws.err"; then
  aws_error
  fail "$IMAGE_VERSION is published but its files.json can't be read"
fi
if ! cmp -s <(nix shell "${tools[@]}" -c jq -S . "$work/published.json") "$FILES_DIR/files.json"; then
  echo "published:"; cat "$work/published.json"
  echo "built:"; cat "$FILES_DIR/files.json"
  fail "$IMAGE_VERSION is already published with other files; image versions are immutable"
fi
echo "$IMAGE_VERSION is already published with these files"
