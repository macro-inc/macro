set -euo pipefail

# What the coverage job reads to tell whether a scenario kept for a known
# bug now passes: the results of the run that has just ended. A job in which
# that run did not happen keeps nothing, and the coverage job fails for it.
rm -rf "$EMAIL_E2E_KNOWN_BUGS"
mkdir -p "$EMAIL_E2E_KNOWN_BUGS"
started="$RUNNER_TEMP/email-e2e-known-bugs-started"
junit=target/nextest/email-e2e/junit.xml
if [ -f "$started" ] && [ -f "$junit" ] && [ "$junit" -nt "$started" ]; then
  cp -p "$junit" "$EMAIL_E2E_KNOWN_BUGS/"
fi
echo "kept $(find "$EMAIL_E2E_KNOWN_BUGS" -name junit.xml | wc -l) results file(s) of the scenarios for known bugs"
