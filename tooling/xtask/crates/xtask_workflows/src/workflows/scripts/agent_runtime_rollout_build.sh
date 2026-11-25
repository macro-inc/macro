set -euo pipefail
[[ $ENVIRONMENT == dev && $(git rev-parse HEAD) == "$SOURCE_SHA" ]]
[[ $NIX_CACHE_URL =~ ^s3://([a-z0-9.-]+)\?(.*\&)?region=([a-z0-9-]+) ]]
bucket=${BASH_REMATCH[1]}
export AWS_DEFAULT_REGION=${BASH_REMATCH[3]}
prefix="agent-runtime-bundles/$SOURCE_SHA"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
tool() { nix shell --inputs-from . nixpkgs#awscli2 nixpkgs#zstd nixpkgs#jq -c "$@"; }
jq() { tool jq "$@"; }

nix build --print-build-logs --out-link "$work/runtime" .#macro-agent-runtime
tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner \
  -C "$work/runtime" -cf "$work/runtime.tar" bun.lock template.json node_modules
tool zstd -q -T1 -10 "$work/runtime.tar" -o "$work/runtime.tar.zst"
digest=$(sha256sum "$work/runtime.tar.zst" | cut -d' ' -f1)
mkdir -p "$ARTIFACT_DIR"
modules="$work/runtime/node_modules/@macro-inc"
jq -nS --arg version "$SOURCE_SHA" --arg digest "$digest" \
  --slurpfile muppet "$modules/muppet/package.json" \
  --slurpfile sdk "$modules/sdk/package.json" \
  --slurpfile observability "$modules/observability/package.json" \
  '{version: $version, digest: $digest, muppetApi: $muppet[0].apiLevel,
    muppetVersion: $muppet[0].version, sdkVersion: $sdk[0].version,
    observabilityVersion: $observability[0].version}' >"$ARTIFACT_DIR/manifest.json"

publish() {
  local path=$1 name=$2
  if tool aws s3api put-object --bucket "$bucket" --key "$prefix/$name" \
    --if-none-match '*' --body "$path" >/dev/null; then
    return
  fi
  # The key cannot be overwritten. A retry succeeds only if the bytes
  # already published to the immutable key are exactly the same.
  tool aws s3api get-object --bucket "$bucket" --key "$prefix/$name" "$work/published" >/dev/null
  cmp --silent "$work/published" "$path" || {
    echo "$SOURCE_SHA already has different $name bytes" >&2
    exit 1
  }
}
publish "$work/runtime.tar.zst" runtime.tar.zst
publish "$ARTIFACT_DIR/manifest.json" manifest.json
echo "Published runtime $SOURCE_SHA (SHA-256 $digest)"
