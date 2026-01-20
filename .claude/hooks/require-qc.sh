#!/bin/bash
# require-qc.sh - Stop hook that requires /qc before completing code changes (for agents)
#
# Reads the session transcript and checks if:
# 1. Code changes were made (Write/Edit tools used)
# 2. /qc was run after those changes
#
# If code was changed but /qc wasn't run, blocks stopping.

set -e

INPUT=$(cat)
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty')

# If no transcript, allow stop (edge case)
if [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; then
  echo '{"ok": true}'
  exit 0
fi

# Check if any code changes were made (Write or Edit tools)
CODE_CHANGED=$(grep -c '"tool_name":\s*"\(Write\|Edit\)"' "$TRANSCRIPT" 2>/dev/null || echo "0")

# If no code changes, allow stop
if [ "$CODE_CHANGED" = "0" ]; then
  echo '{"ok": true}'
  exit 0
fi

# Check if /qc was run (look for QC Results in output)
QC_RUN=$(grep -c "QC Results\|QC passed\|Quality Check Gate" "$TRANSCRIPT" 2>/dev/null || echo "0")

if [ "$QC_RUN" = "0" ]; then
  # Code changed but /qc not run - block stop
  cat <<'EOF'
{
  "ok": false,
  "reason": "You made code changes but haven't run the quality check. Run /qc before completing."
}
EOF
  exit 0
fi

# QC was run, allow stop
echo '{"ok": true}'
