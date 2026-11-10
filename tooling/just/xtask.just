# The xtask_local crate owns all local/dev orchestration; these recipes are
# thin delegates. They target xtask_local directly (rather than the `cargo x`
# launcher) so the `local-stack` feature — off by default so bare CI builds
# skip librdkafka — can be enabled to turn on the Kafka topic provisioning that
# run-local needs. Its own target dir, so `just run_local status` answers at once
# while a service build holds the main one's lock (the flag rather than
# CARGO_TARGET_DIR, which xtask's own child cargo builds would inherit).
xtask := "cargo run --quiet --manifest-path Cargo.toml --target-dir target/xtask -p xtask_local --features local-stack --"

# Short name for the fully local development stack.
alias local := run_local

# Start a fully local stack (xtask: native build + runtime image + infra + proxy + frontend).
#   just run_local                      # default instance
#   just run_local --instance agent-a   # isolated, concurrent instance
#   just run_local --no-doppler --env-file ./local.env --no-frontend --no-build
#   just run_local --no-snapshot        # re-run the full DB/kickstart/index init
#   just run_local --detach             # background, returns once ready (automatic with no terminal)
#   just run_local status --json        # also: wait, logs, rebuild, restart-frontend, stop
run_local *ARGS:
  {{ xtask }} run-local "$@"

# Run local binaries against shared dev resources (no local infra).
run_dev *ARGS:
  {{ xtask }} run-dev "$@"

# Check tools/toolchain/ports/env for the local stack.
doctor-local *ARGS:
  {{ xtask }} doctor-local "$@"

# Show an instance's endpoints and container states without starting anything.
status_local *ARGS:
  @{{ xtask }} status-local "$@"

# Reset (drop, recreate, migrate) the instance database.
reset_local *ARGS:
  {{ xtask }} reset-local "$@"

# Remove an instance's containers, networks, and volumes.
destroy_local *ARGS:
  {{ xtask }} destroy-local "$@"

# Stop an instance's containers, keeping volumes (xtask).
stop_local *ARGS:
  {{ xtask }} stop-local "$@"

# Lower-level stack control for Cursor Cloud and bakes. Prefer run_local, which needs no terminal.
#   just stack up                      # WIPES the instance; static frontend served by the proxy
#   just stack update                  # adopt a new build; volumes stay
#   just stack update --services contacts_service  # rebuild only these; status lists stale ones
#   just stack status --json           # machine-readable state
#   just stack down                    # reclaim everything
stack *ARGS:
  {{ xtask }} stack "$@"

# Start an isolated stack, seed it, and run the local Playwright suite.
local-e2e *ARGS:
  tooling/scripts/run-local-e2e.sh --suite web -- "$@"

# Start and seed the same isolated stack, then run ignored Rust integration tests.
local-e2e-rust *ARGS:
  tooling/scripts/run-local-e2e.sh --suite rust -- "$@"

# Start and seed once, then run the Rust and Playwright suites.
local-e2e-all *ARGS:
  tooling/scripts/run-local-e2e.sh --suite all -- "$@"

# Start and seed the stack, then open Playwright UI mode.
local-e2e-ui *ARGS:
  tooling/scripts/run-local-e2e.sh --suite web --ui -- "$@"
