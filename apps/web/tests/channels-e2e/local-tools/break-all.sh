#!/usr/bin/env bash
# Run every break patch named (or all) against the whole suite, one after another.
\cd /home/teo/.herdr/worktrees/macro/synoet-channels-e2e-base
B=apps/web/tests/channels-e2e/ledger/breaks
names=("$@"); [ ${#names[@]} -eq 0 ] && names=($(ls $B | sed 's/\.patch$//'))
for name in "${names[@]}"; do
  ~/.cache/channels-e2e/break.sh $B/$name.patch '[A-Z]+-\d\d ' > ~/.cache/channels-e2e/breaks/$name.tsv 2>&1
  echo "$name: $(grep -c FAILED ~/.cache/channels-e2e/breaks/$name.tsv) failed, $(grep -c PASSED ~/.cache/channels-e2e/breaks/$name.tsv) passed"
done
