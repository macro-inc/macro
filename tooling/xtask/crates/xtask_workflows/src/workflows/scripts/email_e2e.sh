set -euo pipefail

# Nothing in this build carries debug info, as in the Rust test job, so both
# share sccache entries.
flags=(--locked --config 'profile.dev.package."*".debug=false')

# The services the suite starts. `service_binary_builds` is the test target
# that makes cargo build email_service's real binaries with the features a
# test build resolves; default features, because `local_auth` changes how the
# API authenticates.
cargo test --no-run "${flags[@]}" -p email_service --test service_binary_builds

started=$(date +%s)
cargo nextest run -P email-e2e -p email_e2e "${flags[@]}"
echo "Email end-to-end suite: $(( $(date +%s) - started )) s" | tee -a "$GITHUB_STEP_SUMMARY"
