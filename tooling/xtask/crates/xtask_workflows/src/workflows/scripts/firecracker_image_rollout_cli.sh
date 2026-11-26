set -euo pipefail
export SQLX_OFFLINE=true

# A static binary works on the migrator without the build runner's libraries.
target=x86_64-unknown-linux-musl
# The billing dependency uses OpenSSL. Take the musl headers and archives
# from the same locked Nix input as the build tools.
openssl_dev=$(nix build --inputs-from . --no-link --print-out-paths 'nixpkgs#pkgsStatic.openssl^dev')
openssl_out=$(nix build --inputs-from . --no-link --print-out-paths 'nixpkgs#pkgsStatic.openssl^out')
export X86_64_UNKNOWN_LINUX_MUSL_OPENSSL_INCLUDE_DIR="$openssl_dev/include"
export X86_64_UNKNOWN_LINUX_MUSL_OPENSSL_LIB_DIR="$openssl_out/lib"
export X86_64_UNKNOWN_LINUX_MUSL_OPENSSL_STATIC=1
cargo zigbuild --release --locked --target "$target" -p hosted_runtimes \
  --features image-upgrade-cli --bin image-upgrade

binary="${CARGO_TARGET_DIR:-target}/$target/release/image-upgrade"
headers=$(readelf -lW "$binary")
if grep -qE '^[[:space:]]*INTERP[[:space:]]' <<<"$headers"; then
  echo '::error::the rollout CLI depends on shared libraries'
  exit 1
fi
"$binary" --help
mkdir -p "$CLI_DIR"
install -m 0755 "$binary" "$CLI_DIR/image-upgrade"
digest=$(sha256sum "$CLI_DIR/image-upgrade" | cut -d ' ' -f1)
printf 'sha256=%s\n' "$digest" >>"$GITHUB_OUTPUT"
