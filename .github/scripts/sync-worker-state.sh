#!/usr/bin/env bash
# Compares WORKER_KEY with the version live in ENVIRONMENT and writes `unchanged`
# and `wait_seconds` to GITHUB_OUTPUT. Run from services/sync-service.
#
# The comparison is with what Cloudflare is serving, not the previous push, so a
# cancelled run or a rollback can't make a change look deployed. Anything it
# can't read means deploy: the worst case is the slower path, never a skipped
# worker.
set -uo pipefail

deferral_seconds=300

deploy() {
  echo "Deploying the worker: $1"
  {
    echo "unchanged=false"
    echo "wait_seconds=$deferral_seconds"
  } >>"$GITHUB_OUTPUT"
  exit 0
}

[ -n "${WORKER_KEY:-}" ] || deploy "no input key"

status=$(npx wrangler deployments status --env "$ENVIRONMENT" --json) ||
  deploy "could not read the live deployment"
# A gradual rollout serves two versions, so a single message can't describe it.
version=$(jq -er 'select((.versions | length) == 1 and .versions[0].percentage == 100) | .versions[0].version_id' <<<"$status") ||
  deploy "the live deployment is not one version at 100%"
created_on=$(jq -er '.created_on' <<<"$status") ||
  deploy "the live deployment has no creation time"
created_at=$(date -d "$created_on" +%s) ||
  deploy "could not parse the live deployment time"

details=$(npx wrangler versions view "$version" --env "$ENVIRONMENT" --json) ||
  deploy "could not read live version $version"
message=$(jq -er '.annotations["workers/message"]' <<<"$details") ||
  deploy "live version $version has no input key"
[ "$message" = "inputs:$WORKER_KEY" ] ||
  deploy "live version $version has different inputs"

# The previous deployment may have been cancelled during its wait, so wait out
# whatever is left of the deferral rather than assuming it finished.
wait_seconds=$((deferral_seconds - ($(date +%s) - created_at)))
if [ "$wait_seconds" -lt 0 ]; then wait_seconds=0; fi
if [ "$wait_seconds" -gt "$deferral_seconds" ]; then wait_seconds=$deferral_seconds; fi

echo "Worker inputs match live version $version; skipping deployment, waiting ${wait_seconds}s."
{
  echo "unchanged=true"
  echo "wait_seconds=$wait_seconds"
} >>"$GITHUB_OUTPUT"
