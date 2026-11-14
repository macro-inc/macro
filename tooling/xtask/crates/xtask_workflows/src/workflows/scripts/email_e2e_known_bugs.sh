set -euo pipefail

# The same flags as the build step, so nothing is built twice.
crates/email_e2e/scripts/known_bugs.sh --locked --config 'profile.dev.package."*".debug=false' \
  -E "$EMAIL_E2E_SCENARIOS"
