# Right before publishing, refuse a production bundle older than the live one.
# The build job ran the same check, but a deploy-only re-run or a release that
# published after this one was built would skip it. `rollback: true` (a Deploy
# Web App dispatch) skips it; see infra/stacks/web-app/README.md#rolling-back.
set -euo pipefail

if [ "$ENVIRONMENT" != prod ] || [ "$ROLLBACK" = true ]; then
  exit 0
fi

ours=$(jq -er '.bundleBuild' apps/web/dist/bundle-manifest.json)
live=$(curl -fsS --retry 3 --max-time 30 "$LIVE_MANIFEST_URL" | jq -er '.bundleBuild')
if [ "$ours" -lt "$live" ]; then
  echo "bundle $ours is older than the live bundle $live; revert forward, or dispatch Deploy Web App with rollback: true" >&2
  exit 1
fi
echo "bundle $ours is not older than the live bundle $live"
