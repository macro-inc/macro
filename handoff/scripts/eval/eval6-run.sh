#!/usr/bin/env bash
# The final drafting eval: main against the drafter head, the core cases
# twice and the two sub-routine cases four times, on the subr stack.
set -u
W=$HOME/.herdr/worktrees/macro/synoet-routines-draft-sub-routine-definitions
C=~/.cache/routines-draft-subroutines
E=$C/eval6
MAIN_BIN=${MAIN_BIN:?main build}; BRANCH_BIN=${BRANCH_BIN:?branch build}
\cd $W/crates/scheduled_action/bench
echo "branch head $(git -C $W rev-parse --short=11 HEAD), main bin $MAIN_BIN, branch bin $BRANCH_BIN"
AB="bun drafts.ts ab --instance subr --a main --a-bin $MAIN_BIN --b branch --b-bin $BRANCH_BIN --arm draft"
CORE=eric-says-hello,due-today-digest,channel-message-to-task,weekly-channel-recap,done-log-database,missing-channel-left-out,ask-ai-inbox-triage,add-step-post-urgent,change-step-other-channel,once-budget-reminder,invoice-mail-to-finance,review-status-to-channel,two-jordans,vague-standup,vague-support-watch,launch-overdue-chase,weekly-metrics-ask-ai,hiring-task-to-database,add-step-ask-ai-review,change-step-only-eric
echo "== new $(date -u +%T)"
nix develop $W --command bash -c "$AB --dir $E/new --rounds 4 --cases due-soon-reminders,review-check-later" 2>&1 | grep -v "Git tree"
echo "== core $(date -u +%T)"
nix develop $W --command bash -c "$AB --no-judge --dir $E/core --rounds 2 --cases $CORE" 2>&1 | grep -v "Git tree"
echo "== compare $(date -u +%T)"
nix develop $W --command bash -c "bun drafts.ts compare $E/new/main.draft.json $E/new/branch.draft.json --out $E/new/report.md; bun drafts.ts compare $E/core/main.draft.json $E/core/branch.draft.json --out $E/core/report.md" 2>&1 | grep -v "Git tree"
echo "== done $(date -u +%T)"
