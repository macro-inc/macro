set -euo pipefail

if [ -z "${DOPPLER_TOKEN:-}" ]; then
  echo "DOPPLER_TOKEN secret is required to validate Doppler configs" >&2
  exit 1
fi

if [ -z "${RUSTC_WRAPPER:-}" ]; then
  echo "RUSTC_WRAPPER is required so Doppler config binaries build through sccache" >&2
  exit 1
fi

bins=()
cargo_args=(build --locked --all-features)
while IFS= read -r bin; do
  if [ -z "$bin" ]; then
    continue
  fi

  bins+=("$bin")
  cargo_args+=(--bin "$bin")
done <<< "$DOPPLER_CONFIG_BINS"

if [ "${#bins[@]}" -eq 0 ]; then
  echo "No Doppler config binaries to validate"
  exit 0
fi

echo "Building affected Doppler config binaries with RUSTC_WRAPPER=$RUSTC_WRAPPER"
printf '  %s\n' "${bins[@]}"

(
  cd rust/cloud-storage
  cargo "${cargo_args[@]}"
  for bin in "${bins[@]}"; do
    "./target/debug/$bin"
  done
)
