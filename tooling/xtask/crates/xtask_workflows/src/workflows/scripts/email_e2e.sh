set -euo pipefail

# The same flags as the build step, so nothing is built twice.
flags=(--locked --config 'profile.dev.package."*".debug=false')

# This job's share of the scenarios: a filter, and for the jobs that divide
# one filter between them, which part.
scenarios=(-E "$EMAIL_E2E_SCENARIOS")
if [ -n "${EMAIL_E2E_PARTITION:-}" ]; then
  scenarios+=(--partition "$EMAIL_E2E_PARTITION")
fi

started=$(date +%s)
cargo nextest run -P email-e2e -p email_e2e "${flags[@]}" "${scenarios[@]}"
echo "Email end-to-end scenarios: $(( $(date +%s) - started )) s" | tee -a "$GITHUB_STEP_SUMMARY"
