set -euo pipefail

# The results step keeps only a results file written after this: `target/`
# comes from a cache volume and holds the files of earlier jobs.
touch "$RUNNER_TEMP/email-e2e-known-bugs-started"

# The same flags as the build step, so nothing is built twice.
crates/email_e2e/scripts/known_bugs.sh --locked --config 'profile.dev.package."*".debug=false' \
  -E "$EMAIL_E2E_SCENARIOS"
