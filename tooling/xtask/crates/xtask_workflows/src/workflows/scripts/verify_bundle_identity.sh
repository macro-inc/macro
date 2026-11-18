# The built bundle must be stamped from the commit this run deploys. A
# production deploy must also not be older than the live bundle: native apps
# refuse an older commit's bundle, so redeploying one splits web and native.
# `rollback: true` (a Deploy Web App dispatch) skips only that comparison; see
# infra/stacks/web-app/README.md#rolling-back.
set -euo pipefail

args=(--dist apps/web/dist --commit "$GITHUB_SHA")
if [ "$ENVIRONMENT" = prod ] && [ "$ROLLBACK" != true ]; then
  live="$RUNNER_TEMP/live-bundle-manifest.json"
  curl -fsS --retry 3 --max-time 30 "$LIVE_MANIFEST_URL" -o "$live"
  args+=(--not-older-than "$live")
fi

cargo run --quiet --locked -p bundle_stamp -- verify "${args[@]}"
