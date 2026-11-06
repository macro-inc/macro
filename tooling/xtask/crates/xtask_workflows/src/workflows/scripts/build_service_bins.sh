set -euo pipefail

: "${RUST_PACKAGES:?RUST_PACKAGES is required}"

# The test job never compiles these services' `run` bodies: each is an `impl
# Future` polled only by the bin's `main`, and a bin's test target doesn't call
# `main`. Clippy stops before monomorphization. So a failure only a real build
# finds, such as a recursion limit overflow while instantiating, shows up here.
selected=()
for service in document_storage_service email_service authentication_service; do
  if [ "$RUST_PACKAGES" = "all" ] || [[ " $RUST_PACKAGES " == *" $service "* ]]; then
    selected+=("$service")
  fi
done

if [ "${#selected[@]}" -eq 0 ]; then
  echo "No service binaries were affected"
  exit 0
fi

# The same packages and features as run_tests.sh. Building each service's
# `service_binary_builds` test target, which nothing runs, makes cargo build the
# real binaries under the features `cargo test` resolves, so every other unit is
# one the test job builds too and both jobs share sccache entries. `cargo build`
# would resolve without dev-dependency features and rebuild most of the workspace.
if [ "$RUST_PACKAGES" = "all" ]; then
  package_args=(--workspace --exclude sync_service)
else
  package_args=()
  for package in $RUST_PACKAGES; do
    [ "$package" = "sync_service" ] || package_args+=(-p "$package")
  done
fi

cargo test --no-run --locked --all-features \
  --config 'profile.dev.package."*".debug=false' "${package_args[@]}" \
  --test service_binary_builds
