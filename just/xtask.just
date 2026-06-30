# xtask owns all local/dev orchestration; these recipes are thin delegates.
xtask := "cargo run --quiet --manifest-path rust/cloud-storage/Cargo.toml -p xtask --"

# Start a fully local stack (xtask: zigbuild + runtime image + infra + proxy + frontend).
#   just run_local                      # default instance
#   just run_local --instance agent-a   # isolated, concurrent instance
#   just run_local --no-doppler --env-file ./local.env --no-frontend --no-build
run_local *ARGS:
  {{ xtask }} run-local "$@"

# Run local binaries against shared dev resources (no local infra).
run_dev *ARGS:
  {{ xtask }} run-dev "$@"

# Check tools/toolchain/ports/env for the local stack.
doctor-local *ARGS:
  {{ xtask }} doctor-local "$@"

# Reset (drop, recreate, migrate) the instance database.
reset_local *ARGS:
  {{ xtask }} reset-local "$@"

# Remove an instance's containers, networks, and volumes.
destroy_local *ARGS:
  {{ xtask }} destroy-local "$@"

# Stop an instance's containers, keeping volumes (xtask).
stop_local *ARGS:
  {{ xtask }} stop-local "$@"
