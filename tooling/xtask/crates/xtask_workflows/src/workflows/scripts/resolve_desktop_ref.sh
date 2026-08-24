set -euo pipefail

# Resolve the git ref for desktop builds from any trigger type:
#   push (tag)          → github.ref
#   create (tag)        → github.event.ref
#   workflow_dispatch   → inputs.ref (release tag) or the selected workflow ref

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
    # An empty override means "build the ref selected in GitHub's Run workflow
    # menu". This allows branch builds while keeping explicit overrides limited
    # to release tags.
    if [ -z "$INPUT_REF" ]; then
      echo "ref=$SELECTED_REF" >> "$GITHUB_OUTPUT"
      exit 0
    fi
    if [[ "$INPUT_REF" =~ ^refs/tags/v[0-9][0-9A-Za-z._-]*$ ]]; then
      echo "ref=$INPUT_REF" >> "$GITHUB_OUTPUT"
      exit 0
    fi
    if [[ "$INPUT_REF" =~ ^v[0-9][0-9A-Za-z._-]*$ ]]; then
      echo "ref=refs/tags/$INPUT_REF" >> "$GITHUB_OUTPUT"
      exit 0
    fi
    echo "The ref input only accepts release tags (v*). To build a branch, select it in the Run workflow menu and leave ref empty." >&2
    exit 1
    ;;
  *)
    echo "Unexpected event: $EVENT_NAME" >&2
    exit 1
    ;;
esac
