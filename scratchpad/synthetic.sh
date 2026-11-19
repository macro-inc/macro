#!/usr/bin/env bash
# Runs old and new summarizers over edited inputs that reach the remaining branches.
set -u
S=/tmp/claude-1001/-home-teo--herdr-worktrees-macro-synoet-channels-local-sync/5c052d5a-35e5-475f-8f8a-ea1c0034b3ce/scratchpad
P=crates/messages/proofs
I="$S/in"
rm -rf "$S/sold" "$S/snew"
mkdir -p "$S/sold" "$S/snew"
REV=a40fc0e55d5fe953728b04c93d2273b24e71d977

both() {
  # both <case> <stem> <args...>; output directory is appended unless NO_OUTPUT is set
  local name=$1 stem=$2; shift 2
  mkdir -p "$S/sold/$name" "$S/snew/$name"
  python3 $P/$stem.py "$@" --output "$S/sold/$name" > "$S/sold/$name.out" 2> "$S/sold/$name.err"; echo "exit $?" >> "$S/sold/$name.out"
  bun $P/$stem.ts "$@" --output "$S/snew/$name" > "$S/snew/$name.out" 2> "$S/snew/$name.err"; echo "exit $?" >> "$S/snew/$name.out"
}

# --- pool isolation: recorded data with the legacy labels back at 34 columns
awk -F, 'BEGIN{OFS=","} $2=="baseline"||$2=="bounded5ms"{NF=34} {print}' "$I/pool.log" > "$I/pool_legacy.log"
both pool_real summarize_pool_isolation "$I/pool_legacy.log"

# --- pool isolation: one unknown quoted label, a run without failures (two-value
# median of 0.062 and 0.063), junk lines and CRLF endings
grep '^pool_isolation,deadline50ms,' "$I/pool.log" \
  | awk -F, 'BEGIN{OFS=","}
      $6=="after"&&$7=="flood"&&$5=="1"{$17=$16;$18=0;$19=0;$20=0;$21=0;$22=0;$23=0;$35="NA";$36="NA";$37="NA"}
      $6=="after"&&$7=="flood"&&$5=="2"{$35="0.062"}
      $6=="after"&&$7=="flood"&&$5=="3"{$35="0.063"}
      {$2="\"zz,cu\"\"stom\""; print}' \
  | sed 's/$/\r/' > "$I/pool_custom.log"
printf 'noise line\npool_isolationX,ignored\n' >> "$I/pool_custom.log"
both pool_custom summarize_pool_isolation "$I/pool_custom.log" --expected-seconds 30

# --- pool isolation: a lane with no attempts divides by zero
awk -F, 'BEGIN{OFS=","} $2=="deadline50ms"&&$6=="after"&&$7=="flood"&&$5=="1"{$16=0;$17=0;$18=0;$19=0;$20=0;$21=0;$22=0;$23=0;for(i=24;i<=29;i++)$i="NA";for(i=31;i<=33;i++)$i="NA";$35="NA";$36="NA";$37="NA"} {print}' "$I/pool_legacy.log" > "$I/pool_zero.log"
both pool_zero summarize_pool_isolation "$I/pool_zero.log"

# --- pool isolation failures
both pool_wrong_seconds summarize_pool_isolation "$I/pool_legacy.log" --expected-seconds 31
both pool_partial_wrong summarize_pool_isolation "$I/pool_legacy.log" --partial-counterexample
head -n 20 "$I/pool_legacy.log" > "$I/pool_short.log"
both pool_incomplete summarize_pool_isolation "$I/pool_short.log"
both pool_missing_file summarize_pool_isolation "$I/does_not_exist.log"
both pool_empty summarize_pool_isolation "$I/arrival_a.log"

# --- admission pool: quoted label, CRLF, exact rounding ties (0.0625 at three decimals)
awk -F, 'BEGIN{OFS=","} NR>1&&$7=="neighbor"&&$6=="before"&&$8=="1000"&&$10=="0.000"{$26="0.0625"} NR>1{$2="\"a,b\""} {print}' "$I/admission_pool.log" | sed 's/$/\r/' > "$I/admission_tie.log"
both admission_tie summarize_admission_pool "$I/admission_tie.log" --source-revision "rev with spaces"
both admission_backtick summarize_admission_pool "$I/admission_pool.log" --source-revision 'a`b'
both admission_blank summarize_admission_pool "$I/admission_pool.log" --source-revision '  '
head -n 40 "$I/admission_pool.log" > "$I/admission_short.log"
both admission_incomplete summarize_admission_pool "$I/admission_short.log" --source-revision $REV
cat "$I/admission_pool.log" "$I/admission_pool.log" > "$I/admission_twice.log"
both admission_duplicate summarize_admission_pool "$I/admission_twice.log" --source-revision $REV
sed 's/admission4/admission5/' "$I/admission_short.log" > "$I/admission_other.log"
tail -n +41 "$I/admission_pool.log" >> "$I/admission_other.log"
both admission_two_labels summarize_admission_pool "$I/admission_other.log" --source-revision $REV
head -n 37 "$I/admission_pool.log" > "$I/admission_half_a.log"
tail -n +38 "$I/admission_pool.log" > "$I/admission_half_b.log"
both admission_two_logs summarize_admission_pool "$I/admission_half_b.log" "$I/admission_half_a.log" --source-revision=$REV

# --- bounded latency: a failed request (exit 1 after writing), and two labels
awk -F, 'BEGIN{OFS=","} $6=="measured"&&$5=="2"&&$11=="200"{$14=1999;$15=1;$17=1;$27="1.000";$28="2.000";$29="3.5"} {print}' "$I/bounded.log" > "$I/bounded_error.log"
both bounded_error summarize_bounded_latency "$I/bounded_error.log" --source-revision $REV
sed 's/deadline50ms/another/' "$I/bounded.log" > "$I/bounded_b.log"
both bounded_two_labels summarize_bounded_latency "$I/bounded.log" "$I/bounded_b.log" --source-revision $REV
sed '5s/release/debug/' "$I/bounded.log" > "$I/bounded_debug.log"
both bounded_invalid summarize_bounded_latency "$I/bounded_debug.log" --source-revision $REV

# --- arrival latency: one-decimal ties (0.25, 0.75), padded cells, tabs, CRLF
awk -F'|' 'BEGIN{OFS="|"} $4==" open_loop "&&$7==" 1 "&&$8==" 50 "&&$9==" before "{$22=" 0.25 "} $4==" open_loop "&&$7==" 1 "&&$8==" 50 "&&$9==" after "{$22="\t0.75  "} {print}' "$I/arrival_all.log" | sed 's/$/\r/' > "$I/arrival_tie.log"
: > "$I/empty.log"
both arrival_tie summarize_arrival_latency "$I/arrival_tie.log" "$I/empty.log"
both arrival_incomplete summarize_arrival_latency "$I/arrival_a.log" "$I/empty.log"
sed '3s/| 2000 |/| 2001 |/' "$I/arrival_all.log" > "$I/arrival_bad.log"
both arrival_invalid summarize_arrival_latency "$I/arrival_bad.log" "$I/empty.log"
sed '3s/| 2.294 |/| x |/; 3s/| 0.876 |/| abc |/' "$I/arrival_all.log" > "$I/arrival_nan.log"
both arrival_not_number summarize_arrival_latency "$I/arrival_nan.log" "$I/empty.log"

# --- deadline arrival: number spellings, a low-tail data set, failures
awk -F'|' 'BEGIN{OFS="|"} NR==1{$5=" +1 ";$21=" 39_982.844 ";$17=" 0e0 "} {print}' "$I/deadline_arrival.log" > "$I/deadline_arrival_spelling.log"
both deadline_arrival_spelling summarize_deadline_arrival_latency "$I/deadline_arrival_spelling.log" --source-revision $REV
awk -F'|' 'BEGIN{OFS="|"} {$11=" 0.001 ";$12=" 0.002 ";$13=" 0.003 "; print}' "$I/deadline_arrival.log" > "$I/deadline_arrival_low.log"
both deadline_arrival_low summarize_deadline_arrival_latency "$I/deadline_arrival_low.log" --source-revision $REV
awk -F'|' 'BEGIN{OFS="|"} NR==2{$22=" 99.0 "} {print}' "$I/deadline_arrival.log" > "$I/deadline_arrival_rate.log"
both deadline_arrival_rate summarize_deadline_arrival_latency "$I/deadline_arrival_rate.log" --source-revision $REV
awk -F'|' 'BEGIN{OFS="|"} NR==2{$11=" inf "} NR==3{$11=" nan "} {print}' "$I/deadline_arrival.log" > "$I/deadline_arrival_inf.log"
both deadline_arrival_inf summarize_deadline_arrival_latency "$I/deadline_arrival_inf.log" --source-revision $REV
both deadline_arrival_choice summarize_deadline_arrival_latency "$I/deadline_arrival.log" --source-revision $REV --implementation other

# --- deadline write: negative and positive deltas come from the recorded data; failures
head -n 95 "$I/deadline_write.log" > "$I/deadline_write_short.log"
both deadline_write_incomplete summarize_deadline_write_latency "$I/deadline_write_short.log" --source-revision $REV
sed '1s/| Create |/| Upsert |/' "$I/deadline_write.log" > "$I/deadline_write_op.log"
both deadline_write_operation summarize_deadline_write_latency "$I/deadline_write_op.log" --source-revision $REV
both deadline_write_no_revision summarize_deadline_write_latency "$I/deadline_write.log"

for f in "$S"/sold/*.out; do echo "$(basename "$f" .out): $(tail -n 1 "$f") / $(tail -n 1 "$S/snew/$(basename "$f")")"; done
echo "=== diff of outputs, stdout and exit codes (stderr listed separately)"
diff -r -x '*.err' "$S/sold" "$S/snew"
echo "diff exit $?"
echo "=== last stderr line, old then new"
for f in "$S"/sold/*.err; do
  if [ -s "$f" ] || [ -s "$S/snew/$(basename "$f")" ]; then
    echo "--- $(basename "$f" .err)"
    tail -n 1 "$f" | cut -c1-230
    tail -n 1 "$S/snew/$(basename "$f")" | cut -c1-230
  fi
done

echo "=== help and usage"
for stem in summarize_admission_pool summarize_arrival_latency summarize_bounded_latency summarize_deadline_arrival_latency summarize_deadline_write_latency summarize_pool_isolation sync_append_plan_sql channel_change_plans; do
  python3 $P/$stem.py --help 2>&1 | sed 's/\.py/.ts/' > "$S/help_old.txt"; old=$?
  bun $P/$stem.ts --help > "$S/help_new.txt" 2>&1; new=$?
  cmp -s "$S/help_old.txt" "$S/help_new.txt" && echo "$stem help identical ($new)" || { echo "$stem help DIFFERS"; diff "$S/help_old.txt" "$S/help_new.txt"; }
  python3 $P/$stem.py --bogus > /dev/null 2>&1; old=$?
  bun $P/$stem.ts --bogus > /dev/null 2>&1; new=$?
  echo "$stem unknown option exit: $old / $new"
  python3 $P/$stem.py > /dev/null 2> "$S/usage_old.txt"; old=$?
  bun $P/$stem.ts > /dev/null 2> "$S/usage_new.txt"; new=$?
  echo "$stem no arguments exit: $old / $new"
  [ "$stem" = sync_append_plan_sql ] || { tail -n 1 "$S/usage_old.txt"; tail -n 1 "$S/usage_new.txt"; }
done
