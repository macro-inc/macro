set -euo pipefail

# Publish the simulator build to Appetize and post the preview comment.
#
# The comment is the only store of the Appetize key: recovering it from there
# is what lets a PR keep one app across pushes, and lets the cleanup job find
# it on close. `gh` and `jq` both ship in Namespace's runner image (see
# cancel_stuck_cloud_storage_deploys).

MARKER='<!-- appetize-ios-preview -->'
API='https://api.appetize.io/v1/apps'

bot_comments() {
  gh api "repos/$REPO/issues/$PR_NUMBER/comments" --paginate \
    --jq '.[] | select(.user.type == "Bot")'
}

# Only our comment carries an appetize.io link, so this cannot pick up the web
# preview's comment by accident.
existing_key() {
  bot_comments | jq -r 'select(.body | contains("appetize.io/app/")) | .body' |
    grep -oE 'appetize\.io/app/[A-Za-z0-9_-]+' | head -1 | sed 's|.*/||'
}

PUBLIC_KEY="$(existing_key || true)"

if [ "${CLEANUP:-0}" = "1" ]; then
  if [ -z "$PUBLIC_KEY" ]; then
    echo "No Appetize app recorded on this PR; nothing to clean."
    exit 0
  fi
  # 404 means someone already removed it, which is the desired end state.
  STATUS="$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE "$API/$PUBLIC_KEY" \
    -H "X-API-KEY: $APPETIZE_API_TOKEN")"
  case "$STATUS" in
    2* | 404) echo "Deleted Appetize app $PUBLIC_KEY ($STATUS)" ;;
    *) echo "Appetize delete failed with $STATUS" >&2; exit 1 ;;
  esac
  exit 0
fi

# Session caps, not access restrictions, are what keep a leaked link cheap: a
# 3-minute idle timeout, a 30-minute ceiling and two concurrent sessions, on an
# app that still needs a Macro login to show anything. `run=authenticated`
# would demand an Appetize account and `referrerHostnamesRestricted` would
# reject the click outright (GitHub sends no referrer on external links), so
# both would lock out the reviewer this exists for.
if [ -n "$PUBLIC_KEY" ]; then TARGET="$API/$PUBLIC_KEY"; else TARGET="$API"; fi
RESPONSE="$(curl -sS -X POST "$TARGET" \
  -H "X-API-KEY: $APPETIZE_API_TOKEN" \
  -F "file=@$ARCHIVE_PATH" -F 'platform=ios' -F 'fileType=zip' \
  -F 'timeout=180' -F 'timeLimit=1800' -F 'maxConcurrent=2' \
  -F "note=PR #$PR_NUMBER $SHA $BRANCH" \
  -F 'appPermissions.run=public' -F 'appPermissions.debugLog=public' \
  -F 'appPermissions.networkIntercept=public' \
  -F 'appPermissions.networkProxy=public')"

PUBLIC_KEY="$(jq -er '.publicKey' <<<"$RESPONSE")" || {
  echo "Appetize upload carried no publicKey: $RESPONSE" >&2
  exit 1
}
echo "Appetize app $PUBLIC_KEY"

link() { printf '[%s](https://appetize.io/app/%s?device=%s&autoplay=false)' "$1" "$PUBLIC_KEY" "$2"; }

# `device` is a query parameter over one uploaded build, so extra sizes cost
# nothing: no rebuild, no second upload. osVersion is deliberately omitted so
# links keep working when Appetize retires a runtime.
BODY="$MARKER
**iOS preview** — \`$BRANCH\` @ \`${SHA:0:7}\`

$(link 'iPhone 15 Pro' iphone15pro) · $(link 'iPhone 16 Pro Max' iphone16promax) · $(link 'iPad Pro 12.9"' ipadpro129inch5thgeneration)

Boots on click; nothing streams until then. You will need to sign in inside the simulator."

# get-or-create-id.ts finds the *web* preview comment by this substring and
# scrapes the preview id out of its body, so our comment must never contain it.
case "$BODY" in
  *preview.macro.com*)
    echo "The iOS comment contains preview.macro.com, which would break web previews." >&2
    exit 1
    ;;
esac

COMMENT_ID="$(bot_comments | jq -r "select(.body | contains(\"$MARKER\")) | .id" | head -1)"
if [ -n "$COMMENT_ID" ]; then
  gh api -X PATCH "repos/$REPO/issues/comments/$COMMENT_ID" -f "body=$BODY" >/dev/null
  echo "Updated existing iOS preview comment"
else
  gh api -X POST "repos/$REPO/issues/$PR_NUMBER/comments" -f "body=$BODY" >/dev/null
  echo "Created iOS preview comment"
fi
