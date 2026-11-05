set -euo pipefail

: "${RUST_PACKAGES:?RUST_PACKAGES is required}"

# The test job never compiles these services' `run` bodies: each is an `impl
# Future` polled only by the bin's `main`, and a bin's test target doesn't call
# `main`. Clippy stops before monomorphization. So a failure only a real build
# finds, such as a recursion limit overflow while instantiating, shows up here.
bin_args=()
for service in document_storage_service email_service authentication_service; do
  if [ "$RUST_PACKAGES" = "all" ] || [[ " $RUST_PACKAGES " == *" $service "* ]]; then
    bin_args+=(--bin "$service")
  fi
done

if [ "${#bin_args[@]}" -eq 0 ]; then
  echo "No service binaries were affected"
  exit 0
fi

# The same flags as run_tests.sh, so both jobs share sccache entries.
cargo build --locked --all-features \
  --config 'profile.dev.package."*".debug=false' "${bin_args[@]}"
