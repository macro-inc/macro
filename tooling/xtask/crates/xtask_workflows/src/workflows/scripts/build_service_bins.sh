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

# The same features as run_tests.sh, which unify across the selected packages, so
# both jobs share sccache entries. Only the bins above get built.
if [ "$RUST_PACKAGES" = "all" ]; then
  package_args=(--workspace --exclude sync_service)
else
  package_args=()
  for package in $RUST_PACKAGES; do
    [ "$package" = "sync_service" ] || package_args+=(-p "$package")
  done
fi

cargo build --locked --all-features \
  --config 'profile.dev.package."*".debug=false' "${package_args[@]}" "${bin_args[@]}"
