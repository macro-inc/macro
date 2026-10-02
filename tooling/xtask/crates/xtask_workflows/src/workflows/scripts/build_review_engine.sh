set -euo pipefail

# Build the same pinned structural engine for every macrod release target,
# including aarch64 musl, which upstream does not publish as a binary.
source_dir=$(mktemp -d)
trap 'rm -rf "$source_dir"' EXIT
archive="$source_dir/difftastic.crate"
curl --fail --location --retry 3 --output "$archive" \
  https://static.crates.io/crates/difftastic/difftastic-0.71.0.crate
expected=fe703efd01d39dc825835b9fc5e5ef4f171cdf8aa0e21fa3a08bf40df8bc0f6d
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
else
  actual=$(shasum -a 256 "$archive" | cut -d ' ' -f 1)
fi
[ "$actual" = "$expected" ] || { echo 'difftastic source checksum mismatch' >&2; exit 1; }
tar -xzf "$archive" -C "$source_dir"
case "$TARGET" in
  *-linux-musl) builder=zigbuild ;;
  *-apple-darwin) builder=build ;;
  *) echo "unsupported review engine target: $TARGET" >&2; exit 1 ;;
esac
cargo "$builder" --locked --release --target "$TARGET" \
  --manifest-path "$source_dir/difftastic-0.71.0/Cargo.toml" \
  --target-dir "$PWD/target/review-engine"
