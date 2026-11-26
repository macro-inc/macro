# Fail before any side effect unless every input is what a rollout may run
# with. Inputs arrive in the environment (never pasted into this script).
set -euo pipefail

fail() {
  echo "::error::$1"
  exit 1
}

# Production rollouts need their own approval; this workflow refuses them.
[ "$ENVIRONMENT" = "dev" ] || fail "environment must be dev, not '$ENVIRONMENT'"

# Immutable versions only: a name, a date and a letter. Never a branch,
# 'latest' or 'main'.
[[ "$IMAGE_VERSION" =~ ^[a-z0-9-]+/[0-9]{4}-[0-9]{2}-[0-9]{2}[a-z]$ ]] \
  || fail "image_version '$IMAGE_VERSION' is not like macro-box/2026-11-24a"

# A full commit on main, at or after the agent trace wiring (#12046), so the
# image's agent runtime exports its traces.
TRACE_WIRING=aee4f581307959e81aa25037175675219f3c9ab6
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "source_sha must be a full 40-character commit SHA"
git fetch --quiet origin main
git cat-file -e "$SOURCE_SHA^{commit}" 2>/dev/null || fail "source_sha $SOURCE_SHA is not a commit here"
git merge-base --is-ancestor "$SOURCE_SHA" origin/main || fail "source_sha $SOURCE_SHA is not on main"
git merge-base --is-ancestor "$TRACE_WIRING" "$SOURCE_SHA" \
  || fail "source_sha $SOURCE_SHA predates $TRACE_WIRING (agent trace wiring)"

uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
[[ "$COMPUTERS" =~ ^$uuid(,$uuid)*$ ]] || fail "computers must be comma-separated computer ids"
count=$(tr ',' '\n' <<<"$COMPUTERS" | sort -u | wc -l)
[ "$count" -eq "$(tr ',' '\n' <<<"$COMPUTERS" | wc -l)" ] || fail "a computer is named twice"
[ "$count" -le 50 ] || fail "at most 50 computers per rollout"

[[ "$BATCH_SIZE" =~ ^[1-5]$ ]] || fail "batch_size must be 1 to 5"
[[ "$IDLE_WAIT_MINUTES" =~ ^[0-9]+$ ]] && [ "$IDLE_WAIT_MINUTES" -le 1440 ] \
  || fail "idle_wait_minutes must be 0 to 1440"
[[ "$RECONNECT_TIMEOUT_MINUTES" =~ ^[0-9]+$ ]] \
  && [ "$RECONNECT_TIMEOUT_MINUTES" -ge 1 ] && [ "$RECONNECT_TIMEOUT_MINUTES" -le 30 ] \
  || fail "reconnect_timeout_minutes must be 1 to 30"

echo "rolling $IMAGE_VERSION (from $SOURCE_SHA) onto $count computer(s) in $ENVIRONMENT, $BATCH_SIZE at a time"
