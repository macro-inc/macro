#!/usr/bin/env bash
# Run one Focus scenario against the service binaries in a directory, then show
# what the Focus worker decided for each thread.
# Usage: run-scenario.sh <label> <bin dir> <test binary> <scenario>
set -uo pipefail
S=$(dirname "$0")
label=$1 bins=$2 test=$3 scenario=$4
source "$S/servers.env"
export EMAIL_E2E_BIN_DIR=$bins
cd /home/teo/.herdr/worktrees/macro/synoet-email-focus-linked
printf '\n== %s: email_focus_worker built from %s\n' "$label" "$(cat "$bins/BUILT_FROM")"
printf '== scenario: %s\n' "$scenario"
printf '   Ada has the Focus flag and links the mailbox of Bob, who has a Macro account and no flag.\n'
printf '   Carol and Dan have no flag; Carol links Dan'"'"'s mailbox. Dan'"'"'s mail arrives first,\n'
printf '   Bob'"'"'s once the worker has passed over Dan'"'"'s. The test waits up to 120 s for Bob'"'"'s verdict.\n\n'
start=$(date +%s)
"$test" "$scenario" --exact --nocapture --test-threads=1 2>&1 | grep -v -E '^\s*$' | tail -40
status=${PIPESTATUS[0]}
printf '\n== %s: test exited %s after %ss\n' "$label" "$status" "$(( $(date +%s) - start ))"
log=$(ls -td "$bins"/email-e2e/*/ 2>/dev/null | head -1)
if [ -n "$log" ] && [ -f "$log/email_focus_worker.log" ]; then
  printf '== what the worker decided (%s)\n' "email_focus_worker.log"
  grep -E 'focus classified|focus skipped' "$log/email_focus_worker.log" \
    | sed -E -e 's/\x1b\[[0-9;]*m//g' -e 's/macro\|[^ ",]+/macro|<user>/g' -e 's/^ *([0-9T:-]+)\.[0-9]+Z/\1Z/' -e 's/email_focus_worker::inbound::kafka_consumer: //' | tail -12
fi
exit "$status"
