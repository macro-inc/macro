set -euo pipefail

# What the coverage report reads: the run's results, and the record each
# scenario left of what it made the backend do. Taken before the scenarios
# for known bugs run, which are not gating and would overwrite the results.
#
# `target/` comes from a cache volume and keeps the files of earlier jobs,
# so only what this job wrote is taken: files newer than the mark the
# scenarios' step left when it started.
rm -rf "$EMAIL_E2E_RESULTS"
mkdir -p "$EMAIL_E2E_RESULTS"
started="$RUNNER_TEMP/email-e2e-started"
if [ ! -f "$started" ]; then
  echo "the scenarios did not start: nothing to keep"
  exit 0
fi
junit=target/nextest/email-e2e/junit.xml
if [ -f "$junit" ] && [ "$junit" -nt "$started" ]; then
  cp -p "$junit" "$EMAIL_E2E_RESULTS/"
fi
if [ -d target/debug/email-e2e ]; then
  (cd target/debug/email-e2e && find . -name evidence.json -newer "$started" -exec cp -p --parents {} "$OLDPWD/$EMAIL_E2E_RESULTS/" \;)
fi
echo "kept $(find "$EMAIL_E2E_RESULTS" -name junit.xml | wc -l) results file(s) and $(find "$EMAIL_E2E_RESULTS" -name evidence.json | wc -l) record(s)"
ls -l --time-style=full-iso "$started" "$junit" 2>&1 || true
echo "target/debug/email-e2e holds $(find target/debug/email-e2e -name evidence.json 2>/dev/null | wc -l) record(s) in all"
