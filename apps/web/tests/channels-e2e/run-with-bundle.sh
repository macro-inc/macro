#!/usr/bin/env bash
# Runs the suite or the fuzzer of this checkout against the app of another
# branch: builds that branch's web bundle, serves it from a local stack
# instance in place of the bundle the instance has, and runs.
#
#   run-with-bundle.sh <instance> <git ref | checkout directory> [suite|fuzz] [playwright arguments]
#
# The tests are this checkout's; the app is the other branch's; the services
# are whatever the instance runs, so update the instance from that branch
# first when its services differ (`just stack update --instance <instance>`).
# Every VITE_* variable set here goes to the build and to the run, so
# VITE_ENABLE_CHANNEL_LOCAL_SYNC=true builds the app that keeps channels on
# the device and tells the tests so. Bundles are kept by commit and by those
# variables under CHANNELS_E2E_BUNDLES (default ~/.cache/channels-e2e/bundles);
# a checkout with uncommitted changes is built every time.
set -euo pipefail

usage() {
  sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}
[ $# -ge 2 ] || usage
instance=$1
source=$2
shift 2
what=suite
case "${1:-}" in
  suite | fuzz)
    what=$1
    shift
    ;;
esac

web=$(cd "$(dirname "$0")/../.." && pwd)
root=$(git -C "$web" rev-parse --show-toplevel)
cache=${CHANNELS_E2E_BUNDLES:-$HOME/.cache/channels-e2e/bundles}
mkdir -p "$cache"

# The commit to build and where its files are.
made_checkout=
if [ -d "$source" ]; then
  checkout=$(git -C "$source" rev-parse --show-toplevel)
  commit=$(git -C "$checkout" rev-parse HEAD)
  if [ -n "$(git -C "$checkout" status --porcelain --untracked-files=no)" ]; then
    commit=$commit-changed
  fi
else
  commit=$(git -C "$root" rev-parse --verify "$source^{commit}")
  checkout=$cache/checkout-$commit
fi
settings=$({ env | grep '^VITE_' || true; } | sort | sha256sum | cut -c1-12)
bundle=$cache/$commit-$settings

if [ ! -f "$bundle/index.html" ] || [[ $commit == *-changed ]]; then
  if [ ! -d "$checkout" ]; then
    git -C "$root" worktree add --detach "$checkout" "$commit" >&2
    made_checkout=1
  fi
  echo "building the app of $commit" >&2
  (
    cd "$checkout"
    bun install --frozen-lockfile >&2
    cd apps/web
    # `bun run build` does not rebuild the engine a device keeps channels with.
    just build-cache-wasm >&2
    # As `just stack up` builds the bundle a local instance serves
    # (xtask_local's `static_build_command`).
    MODE=development NODE_ENV=production VITE_LOCAL_SERVERS=ALL \
      VITE_LOCAL_BACKEND_ORIGIN=same-origin VITE_LOCAL_ONLY=true \
      VITE_AI_EDITING_WORKER_URL=/ai-editing VITE_LOCAL_STACK=true \
      bun run --bun build >&2
    test -f dist/index.html
    rm -rf "$bundle"
    mkdir -p "$bundle"
    cp -a dist/. "$bundle/"
  )
  if [ -n "$made_checkout" ]; then
    git -C "$root" worktree remove --force "$checkout"
  fi
fi

# The directory the instance's proxy serves the app from.
served=
for container in $(docker ps -q --filter "label=com.docker.compose.project=macro-$instance"); do
  served=$(docker inspect "$container" \
    --format '{{range .Mounts}}{{if eq .Destination "/srv/frontend"}}{{.Source}}{{end}}{{end}}')
  [ -z "$served" ] || break
done
if [ -z "$served" ]; then
  echo "instance $instance serves no built app: is it up, and started with a static frontend?" >&2
  exit 1
fi
find "$served" -mindepth 1 -delete
cp -a "$bundle/." "$served/"
echo "instance $instance now serves the app of $commit" >&2

cd "$web"
status=$(cd "$root" && just stack status --json --instance "$instance")
proxy=$(jq -er .proxy_url <<<"$status")
export CHANNELS_E2E_STACK_URL="$proxy"
config=tests/channels-e2e/playwright.config.ts
[ "$what" = suite ] || config=tests/channels-e2e/fuzz/playwright.config.ts
env -u LD_LIBRARY_PATH bunx playwright test --config "$config" "$@"
