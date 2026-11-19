#!/usr/bin/env bash
# Runs the two source-reading scripts, old and new, on the real tree and on
# temporarily edited copies of the files they read. Every edit is reverted.
set -u
S=/tmp/claude-1001/-home-teo--herdr-worktrees-macro-synoet-channels-local-sync/5c052d5a-35e5-475f-8f8a-ea1c0034b3ce/scratchpad
P=crates/messages/proofs
R=crates/messages/src/outbound/pg_message_repo
DELAYED=$R/test/benchmark/delayed.rs
BASELINE=$R/test/baseline.rs
APPEND=crates/channel_change_db_utils/src/append.rs
PROOF=$P/channel_change_append_plans.sql
rm -rf "$S/audit"
mkdir -p "$S/audit/keep"
cp $DELAYED "$S/audit/keep/delayed.rs"
cp $BASELINE "$S/audit/keep/baseline.rs"
cp $APPEND "$S/audit/keep/append.rs"
cp $PROOF "$S/audit/keep/proof.sql"

restore() {
  cp "$S/audit/keep/delayed.rs" $DELAYED
  cp "$S/audit/keep/baseline.rs" $BASELINE
  cp "$S/audit/keep/append.rs" $APPEND
  cp "$S/audit/keep/proof.sql" $PROOF
}
trap restore EXIT

compare() {
  # compare <case> <stem> [args...]
  local name=$1 stem=$2; shift 2
  python3 $P/$stem.py "$@" > "$S/audit/$name.old.out" 2> "$S/audit/$name.old.err"; local old=$?
  bun $P/$stem.ts "$@" > "$S/audit/$name.new.out" 2> "$S/audit/$name.new.err"; local new=$?
  local verdict=identical
  cmp -s "$S/audit/$name.old.out" "$S/audit/$name.new.out" || verdict="STDOUT DIFFERS"
  cmp -s "$S/audit/$name.old.err" "$S/audit/$name.new.err" || verdict="$verdict, STDERR DIFFERS"
  echo "$name: exit $old / $new, stdout $(wc -l < "$S/audit/$name.old.out") lines, stderr $(wc -l < "$S/audit/$name.old.err") lines: $verdict"
}

compare real_check check_delayed_writers
compare real_sync sync_append_plan_sql --check

sed -i '60,70d' $DELAYED;                       compare delete_chunk check_delayed_writers; restore
sed -i '250,260{p}' $DELAYED;                   compare duplicate_chunk check_delayed_writers; restore
sed -i '150s/message/massage/' $DELAYED;        compare rename_token check_delayed_writers; restore
sed -i '130d' $DELAYED;                         compare no_sleep check_delayed_writers; restore
sed -i '133s/.*/        Ok(message)/' $DELAYED; compare plain_ok check_delayed_writers; restore
sed -i '245d;270d;281d;300d;322d;340d' $DELAYED; compare scattered check_delayed_writers; restore
sed -i '26,27d' $DELAYED;                       compare parameters check_delayed_writers; restore
sed -i '446s/delete_after_commit_delay/delete_later/' $DELAYED; compare missing_method check_delayed_writers; restore
echo 'const X: &str = "abc' >> $DELAYED;        compare open_string check_delayed_writers; restore
echo '/* never closed' >> $DELAYED;             compare open_comment check_delayed_writers; restore
echo 'const X: &str = r##"abc"#;' >> $DELAYED;  compare open_raw_string check_delayed_writers; restore
sed -i '12,16d' $DELAYED;                       compare helper check_delayed_writers; restore
lines=$(wc -l < $BASELINE)
sed -i "$((lines / 3))d;$((lines / 2))d" $BASELINE; compare baseline_edit check_delayed_writers; restore
rm $DELAYED;                                    compare missing_file check_delayed_writers; restore

# sync_append_plan_sql: a stale proof, then the rewrite done by each version
sed -i 's/ON CONFLICT/ON  CONFLICT/' $APPEND
compare stale_check sync_append_plan_sql --check
python3 $P/sync_append_plan_sql.py > "$S/audit/rewrite.old.out" 2>&1; echo "exit $?" >> "$S/audit/rewrite.old.out"
cp $PROOF "$S/audit/rewrite.old.sql"
cp "$S/audit/keep/proof.sql" $PROOF
bun $P/sync_append_plan_sql.ts > "$S/audit/rewrite.new.out" 2>&1; echo "exit $?" >> "$S/audit/rewrite.new.out"
cp $PROOF "$S/audit/rewrite.new.sql"
cmp "$S/audit/rewrite.old.sql" "$S/audit/rewrite.new.sql" && cmp "$S/audit/rewrite.old.out" "$S/audit/rewrite.new.out" && echo "rewrite: identical file and output; changed lines vs original: $(diff "$S/audit/keep/proof.sql" "$S/audit/rewrite.new.sql" | grep -c '^[<>]')"
cat "$S/audit/rewrite.new.out"
restore
sed -i 's/PREPARE append_scalar/PREPARE append_scalar_x/' $PROOF; compare no_block sync_append_plan_sql --check; restore
sed -i 's/sqlx::query_scalar!/sqlx::query_other!/' $APPEND;         compare query_count sync_append_plan_sql --check; restore
compare extra_argument sync_append_plan_sql extra

echo "=== stderr where it differs (old, then new)"
for f in "$S"/audit/*.old.err; do
  n=${f%.old.err}.new.err
  cmp -s "$f" "$n" || { echo "--- $(basename "$f" .old.err)"; tail -n 2 "$f" | cut -c1-200; echo "  vs"; tail -n 2 "$n" | cut -c1-200; }
done
echo "=== sample failure output (new)"
head -n 14 "$S/audit/scattered.new.err"
