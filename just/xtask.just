# The xtask_local crate owns all local/dev orchestration; these recipes are
# thin delegates. They target xtask_local directly (rather than the `cargo x`
# launcher) so the `local-stack` feature — off by default so bare CI builds
# skip librdkafka — can be enabled to turn on the Kafka topic provisioning that
# run-local needs.
xtask := "cargo run --quiet --manifest-path rust/cloud-storage/Cargo.toml -p xtask_local --features local-stack --"

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

# Headless stack orchestration for previews, agents, and CI.
#   just stack up                      # full stack; static frontend served by the proxy
#   just stack update                  # rebuild + reload only what changed (the `r` hotkey)
#   just stack status --json           # machine-readable state
#   just stack expose --detach         # public URL via a Cloudflare quick tunnel
#   just stack down                    # reclaim everything
stack *ARGS:
  {{ xtask }} stack "$@"
