# Build the image at the checked-out commit, record each file's SHA-256 and
# size, and publish the files zstd-compressed to the Nix cache bucket under
# firecracker-images/<version>/<sha256>-<name>.zst. Reuse a published version
# from the same commit. Writes the manifest to $FILES_DIR/files.json for
# the roll-out job.
set -euo pipefail

fail() {
  echo "::error::$1"
  exit 1
}

[ "$(git rev-parse HEAD)" = "$SOURCE_SHA" ] || fail "checked out $(git rev-parse HEAD), not $SOURCE_SHA"

# s3://<bucket>?region=<region>
[[ "${NIX_CACHE_URL:-}" =~ ^s3://([a-z0-9.-]+)\?(.*&)?region=([a-z0-9-]+) ]] \
  || fail "the NIX_CACHE_URL repository variable is not an s3:// URL with a region"
bucket=${BASH_REMATCH[1]}
export AWS_DEFAULT_REGION=${BASH_REMATCH[3]}
prefix="firecracker-images/$IMAGE_VERSION"

mkdir -p "$FILES_DIR"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
tools=(--inputs-from . nixpkgs#awscli2 nixpkgs#zstd nixpkgs#jq)

aws_error() {
  # Keep the full AWS error in the log, including any continuation lines.
  echo "AWS said:"
  cat "$work/aws.err"
}

read_published_manifest() {
  nix shell "${tools[@]}" -c aws s3api get-object --bucket "$bucket" --key "$prefix/files.json" \
    "$work/published.json" >/dev/null 2>"$work/aws.err"
}

if read_published_manifest; then
  # Fresh builds of the same commit can produce different digests. Use the
  # files from the first successful publish, after checking their source.
  # shellcheck disable=SC2016 # $source_sha is jq's, not the shell's
  nix shell "${tools[@]}" -c jq -e --arg source_sha "$SOURCE_SHA" '.source_sha == $source_sha' \
    "$work/published.json" >/dev/null || fail "$IMAGE_VERSION has a different published source commit"
  nix shell "${tools[@]}" -c jq -eS '
    select((.files | type) == "array")
    | select((.files | map(.name) | sort) == ["boot_args", "rootfs.ext4", "vmlinux"])
    | select(all(.files[]; (.sha256 | test("^[0-9a-f]{64}$")) and
        (.bytes | type == "number" and . > 0 and . % 1 == 0)))
    ' "$work/published.json" >"$FILES_DIR/files.json" || fail "$IMAGE_VERSION has an invalid published manifest"
  echo "reusing $IMAGE_VERSION published from $SOURCE_SHA"
  exit 0
fi

# S3 can return 403 for a missing key when the key cannot list the bucket.
# The conditional manifest write below resolves that ambiguity.
grep -qE '\((403|404|AccessDenied|NoSuchKey|NotFound)\)' "$work/aws.err" \
  || { aws_error; fail "checking whether $IMAGE_VERSION is published failed"; }

[ -e "${KVM_DEVICE:-/dev/kvm}" ] || fail "this runner has no /dev/kvm; the image's disk build needs it"
nix build --print-build-logs --out-link result-image .#macro-box-firecracker

entries=()
for name in vmlinux rootfs.ext4 boot_args; do
  file="result-image/$name"
  sha256=$(sha256sum "$file" | cut -d' ' -f1)
  bytes=$(stat -L -c %s "$file")
  entries+=("{\"name\":\"$name\",\"sha256\":\"$sha256\",\"bytes\":$bytes}")
  echo "$name: $bytes bytes, sha256 $sha256"
done
files=$(IFS=,; echo "[${entries[*]}]")
# shellcheck disable=SC2016 # $source_sha is jq's, not the shell's
nix shell "${tools[@]}" -c jq -S --arg source_sha "$SOURCE_SHA" '{source_sha: $source_sha, files: .}' \
  <<<"$files" >"$FILES_DIR/files.json"

# Name each object with the SHA-256 of the uncompressed file. A retry can
# upload the same file to the same key. Commit the version by conditionally
# creating files.json after all uploads complete.
for name in vmlinux rootfs.ext4 boot_args; do
  # shellcheck disable=SC2016 # $name is jq's, not the shell's
  sha256=$(nix shell "${tools[@]}" -c jq -r --arg name "$name" '.files[] | select(.name == $name) | .sha256' "$FILES_DIR/files.json")
  # Nix exposes the kernel and system disk as symlinks. Shell redirection
  # opens their contents before passing them to zstd.
  nix shell "${tools[@]}" -c zstd --no-progress -T0 -10 -c <"result-image/$name" >"$work/$name.zst" \
    || fail "compressing $name failed"
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
if ! read_published_manifest; then
  aws_error
  fail "$IMAGE_VERSION is published but its files.json can't be read"
fi
if ! cmp -s <(nix shell "${tools[@]}" -c jq -S . "$work/published.json") "$FILES_DIR/files.json"; then
  echo "published:"; cat "$work/published.json"
  echo "built:"; cat "$FILES_DIR/files.json"
  fail "$IMAGE_VERSION is already published with other files; image versions are immutable"
fi
echo "$IMAGE_VERSION is already published with these files"
