set -euo pipefail

# What the coverage report reads: the run's results, and the record each
# scenario left of what it made the backend do. Taken before the scenarios
# for known bugs run, which are not gating and would overwrite the results.
mkdir -p "$EMAIL_E2E_RESULTS"
if [ -f target/nextest/email-e2e/junit.xml ]; then
  cp target/nextest/email-e2e/junit.xml "$EMAIL_E2E_RESULTS/"
fi
if [ -d target/debug/email-e2e ]; then
  (cd target/debug/email-e2e && find . -name evidence.json -exec cp --parents {} "$OLDPWD/$EMAIL_E2E_RESULTS/" \;)
fi
