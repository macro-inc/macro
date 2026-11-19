#!/usr/bin/env bash
# Runs each summarizer, old and new, over inputs rebuilt from the recorded CSVs.
set -u
S=/tmp/claude-1001/-home-teo--herdr-worktrees-macro-synoet-channels-local-sync/5c052d5a-35e5-475f-8f8a-ea1c0034b3ce/scratchpad
P=crates/messages/proofs
rm -rf "$S/in" "$S/old" "$S/new"
mkdir -p "$S/in" "$S/old" "$S/new"

table() { tail -n +2 "$1" | sed 's/,/ | /g; s/^/| /; s/$/ |/'; }

cp $P/channel_admission_pool_runs.csv "$S/in/admission_pool.log"
cp $P/channel_bounded_latency_runs.csv "$S/in/bounded.log"
cp $P/channel_pool_isolation_runs.csv "$S/in/pool.log"
cp $P/channel_pool_isolation_bounded50ms_partial_runs.csv "$S/in/pool_partial.log"
table $P/channel_arrival_latency_runs.csv > "$S/in/arrival_all.log"
head -n 60 "$S/in/arrival_all.log" > "$S/in/arrival_a.log"
tail -n +61 "$S/in/arrival_all.log" > "$S/in/arrival_b.log"
table $P/channel_deadline_arrival_latency_runs.csv > "$S/in/deadline_arrival.log"
table $P/channel_admission_arrival_latency_runs.csv > "$S/in/admission_arrival.log"
table $P/channel_deadline_write_latency_runs.csv > "$S/in/deadline_write.log"
table $P/channel_admission_write_latency_runs.csv > "$S/in/admission_write.log"

REV=a40fc0e55d5fe953728b04c93d2273b24e71d977
both() {
  # both <case> <stem> <args...>
  local name=$1 stem=$2; shift 2
  mkdir -p "$S/old/$name" "$S/new/$name"
  python3 $P/$stem.py "$@" --output "$S/old/$name" > "$S/old/$name.out" 2> "$S/old/$name.err"; echo "exit $?" >> "$S/old/$name.out"
  bun $P/$stem.ts "$@" --output "$S/new/$name" > "$S/new/$name.out" 2> "$S/new/$name.err"; echo "exit $?" >> "$S/new/$name.out"
}

both admission_pool summarize_admission_pool "$S/in/admission_pool.log" --source-revision $REV
both bounded summarize_bounded_latency "$S/in/bounded.log" --source-revision $REV
both pool summarize_pool_isolation "$S/in/pool.log"
both pool_partial summarize_pool_isolation "$S/in/pool_partial.log" --partial-counterexample
both arrival summarize_arrival_latency "$S/in/arrival_a.log" "$S/in/arrival_b.log"
both deadline_arrival summarize_deadline_arrival_latency "$S/in/deadline_arrival.log" --source-revision $REV
both admission_arrival summarize_deadline_arrival_latency "$S/in/admission_arrival.log" --source-revision $REV --implementation admission
both deadline_write summarize_deadline_write_latency "$S/in/deadline_write.log" --source-revision $REV
both admission_write summarize_deadline_write_latency "$S/in/admission_write.log" --source-revision $REV --implementation=admission

for f in "$S"/old/*.out; do echo "$(basename "$f"): $(tail -n 1 "$f") / $(tail -n 1 "$S/new/$(basename "$f")")"; done
find "$S/old" -type f | sort | xargs wc -c | tail -n 30
echo "=== diff old new"
diff -r "$S/old" "$S/new"
echo "diff exit $?"
