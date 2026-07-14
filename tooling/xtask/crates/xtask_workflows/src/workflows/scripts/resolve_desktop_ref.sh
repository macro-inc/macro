set -euo pipefail

# Resolve the git ref for desktop builds from any trigger type:
#   push (tag)          → github.ref
#   create (tag)        → github.event.ref
#   workflow_dispatch   → inputs.ref (validated) or github.ref (protected)

case "$EVENT_NAME" in
  push)
    echo "ref=$SELECTED_REF" >> "$GITHUB_OUTPUT"
    ;;
  create)
    if [ "$GITHUB_EVENT_REF_TYPE" != "tag" ]; then
      echo "create event was not a tag; skipping" >&2
      exit 1
    fi
    echo "ref=$GITHUB_EVENT_REF" >> "$GITHUB_OUTPUT"
    ;;
  workflow_dispatch)
    ref="${INPUT_REF:-$SELECTED_REF}"
    if [[ "$ref" =~ ^refs/tags/v[0-9][0-9A-Za-z._-]*$ ]]; then
      echo "ref=$ref" >> "$GITHUB_OUTPUT"
      exit 0
    fi
    if [[ "$ref" =~ ^v[0-9][0-9A-Za-z._-]*$ ]]; then
      echo "ref=refs/tags/$ref" >> "$GITHUB_OUTPUT"
      exit 0
    fi
    if [ -z "$INPUT_REF" ] && [ "$SELECTED_REF_PROTECTED" = "true" ]; then
      echo "ref=$SELECTED_REF" >> "$GITHUB_OUTPUT"
      exit 0
    fi
    echo "Manual desktop builds only allow release tags (v*) or a protected ref." >&2
    exit 1
    ;;
  *)
    echo "Unexpected event: $EVENT_NAME" >&2
    exit 1
    ;;
esac
