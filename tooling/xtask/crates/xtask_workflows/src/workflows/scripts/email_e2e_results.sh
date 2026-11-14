set -euo pipefail

# What the coverage report reads: the run's results, and the record each
# scenario left of what it made the backend do. Taken before the scenarios
# for known bugs run, which are not gating and would overwrite the results.
#
# `target/` comes from a cache volume and keeps the files of earlier jobs,
# so only what this job wrote is taken: files newer than the event file the
# runner writes when the job starts.
rm -rf "$EMAIL_E2E_RESULTS"
mkdir -p "$EMAIL_E2E_RESULTS"
junit=target/nextest/email-e2e/junit.xml
if [ -f "$junit" ] && [ "$junit" -nt "$GITHUB_EVENT_PATH" ]; then
  cp -p "$junit" "$EMAIL_E2E_RESULTS/"
fi
if [ -d target/debug/email-e2e ]; then
  (cd target/debug/email-e2e && find . -name evidence.json -newer "$GITHUB_EVENT_PATH" -exec cp -p --parents {} "$OLDPWD/$EMAIL_E2E_RESULTS/" \;)
fi
