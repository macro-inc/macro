#!/usr/bin/env bash
# channel_change_plans, old and new, without any database:
#  1. real psql pointed at a closed port (fails at the first connection, after
#     the seed and query files are written);
#  2. a stub psql that prints canned text, to run the plan parsing and summary.
set -u
S=/tmp/claude-1001/-home-teo--herdr-worktrees-macro-synoet-channels-local-sync/5c052d5a-35e5-475f-8f8a-ea1c0034b3ce/scratchpad
P=crates/messages/proofs
rm -rf "$S/plans"
mkdir -p "$S/plans"
chmod +x "$S/stub/psql"

echo "listeners on port 1: $(ss -ltn 2>/dev/null | awk '{print $4}' | grep -c ':1$')"
echo "psql: $(command -v psql)"

run() {
  # run <case> <args...>
  local name=$1; shift
  python3 $P/channel_change_plans.py "$@" --output "$S/plans/$name.old" > "$S/plans/$name.old.out" 2> "$S/plans/$name.old.err"; local old=$?
  bun $P/channel_change_plans.ts "$@" --output "$S/plans/$name.new" > "$S/plans/$name.new.out" 2> "$S/plans/$name.new.err"; local new=$?
  sed -i "s|$name.old|$name.new|" "$S/plans/$name.old.out"
  local verdict=identical
  diff -r "$S/plans/$name.old" "$S/plans/$name.new" > "$S/plans/$name.diff" 2>&1 || verdict="FILES DIFFER"
  cmp -s "$S/plans/$name.old.out" "$S/plans/$name.new.out" || verdict="$verdict, STDOUT DIFFERS"
  echo "$name: exit $old / $new, files $(ls "$S/plans/$name.old" 2>/dev/null | wc -l) / $(ls "$S/plans/$name.new" 2>/dev/null | wc -l), stdout lines $(wc -l < "$S/plans/$name.old.out"): $verdict"
  echo "   old stderr: $(tail -n 1 "$S/plans/$name.old.err" | cut -c1-150)"
  echo "   new stderr: $(tail -n 1 "$S/plans/$name.new.err" | cut -c1-150)"
}

run closed_port --port 1 --user "te st'u(1)*!~" --suffix dry_1
run ipv6 --host ::1 --port 1 --user plan --suffix dry_2 --maintenance-db "main db"
run bad_port --port 0 --user plan
run bad_port_text --port abc --user plan
run bad_suffix --port 1 --user plan --suffix Dry-1
run bad_host --host 10.0.0.1 --port 1 --user plan
mkdir -p "$S/plans/exists.old" "$S/plans/exists.new"
run exists --port 1 --user plan --suffix dry_3

export STUB_LOG="$S/plans/stub.log"
PATH="$S/stub:$PATH" run stub --port 1 --user "plan user" --suffix stub_1
echo "stub psql calls: $(wc -l < "$STUB_LOG"), distinct connection strings:"
sort -u "$STUB_LOG"
echo "--- stdout sample (new)"
sed -n '1,3p' "$S/plans/stub.new.out"; tail -n 1 "$S/plans/stub.new.out"
echo "--- summary.json sample (new)"
sed -n '1,45p' "$S/plans/stub.new/summary.json"
PATH="/nonexistent" /usr/bin/env -i PATH=/nonexistent "$(command -v bun)" $P/channel_change_plans.ts --port 1 --user plan > /dev/null 2> "$S/plans/nopsql.err"; echo "no psql on PATH: exit $? $(tail -n 1 "$S/plans/nopsql.err")"
