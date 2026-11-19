#!/usr/bin/env bash
# More edited-source comparisons for check_delayed_writers: several hunks.
set -u
S=/tmp/claude-1001/-home-teo--herdr-worktrees-macro-synoet-channels-local-sync/5c052d5a-35e5-475f-8f8a-ea1c0034b3ce/scratchpad
P=crates/messages/proofs
DELAYED=crates/messages/src/outbound/pg_message_repo/test/benchmark/delayed.rs
mkdir -p "$S/audit2"
cp $DELAYED "$S/audit2/delayed.rs"
restore() { cp "$S/audit2/delayed.rs" $DELAYED; }
trap restore EXIT

compare() {
  local name=$1
  python3 $P/check_delayed_writers.py > "$S/audit2/$name.old.out" 2> "$S/audit2/$name.old.err"; local old=$?
  bun $P/check_delayed_writers.ts > "$S/audit2/$name.new.out" 2> "$S/audit2/$name.new.err"; local new=$?
  cmp -s "$S/audit2/$name.old.out" "$S/audit2/$name.new.out" && cmp -s "$S/audit2/$name.old.err" "$S/audit2/$name.new.err" && verdict=identical || verdict=DIFFERS
  echo "$name: exit $old / $new, stderr $(wc -l < "$S/audit2/$name.old.err") lines, hunks $(grep -c '^@@' "$S/audit2/$name.old.err"): $verdict"
}

sed -i '260s/[a-z_]\{3,\}/zzz/; 300s/[a-z_]\{3,\}/zzz/; 330s/[a-z_]\{3,\}/zzz/' $DELAYED; compare three_words; restore
sed -i '45s/[a-z_]\{3,\}/zzz/; 100s/[a-z_]\{3,\}/zzz/' $DELAYED; compare two_words_before; restore
sed -i '140s/[a-z_]\{3,\}/zzz zzz zzz/; 160d' $DELAYED; compare edit_method; restore
sed -i '400,402d; 420s/[a-z_]\{3,\}/qqq/g' $DELAYED; compare react_after; restore
sed -i '452s/$/ let extra = 1;/' $DELAYED; compare delete_after_insert; restore
sed -n '1,6p' "$S/audit2/three_words.new.err"
