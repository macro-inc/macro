#!/usr/bin/env bash
# Run the three Focus inbox reads through EXPLAIN (ANALYZE, BUFFERS), custom and
# generic plans, twice each, on one scratch database.
# Usage: measure.sh <database> [query-file-suffix]
set -euo pipefail
S=$(dirname "$0")
P=/nix/store/znsip1g1bhnpqp918d709gcmx3lm0vcn-postgresql-and-plugins-14.23/bin
U=$("$S/../pg.sh" url)
DB=$1
SUFFIX=${2:-}

# A thread in the shared mailbox read by 500 users, and one in a mailbox
# linked to nobody.
SHARED="md5('big1')::uuid"
UNLINKED="md5('thread4')::uuid"

run() {
  local name=$1 types=$2 body=$3
  shift 3
  local sql="SET random_page_cost = 1.1; SET work_mem = '16MB'; SET jit = off; SET statement_timeout = '60s';
PREPARE q$types AS $body;"
  for mode in force_custom_plan force_generic_plan; do
    for args in "$@"; do
      for pass in first repeated; do
        sql+="
SET plan_cache_mode = $mode;
\\echo '=== $name $mode $pass $args'
EXPLAIN (ANALYZE, BUFFERS) EXECUTE q$args;"
      done
    done
  done
  "$P/psql" -X -q "$U/$DB" <<<"$sql"
}

run thread_inbox "(uuid)" "$(cat "$S/thread_inbox$SUFFIX.sql")" "($SHARED)" "($UNLINKED)"
run inboxes_with_focus "" "$(cat "$S/inboxes_with_focus$SUFFIX.sql")" ""
run syncing_inboxes "" "$(cat "$S/syncing_inboxes$SUFFIX.sql")" ""
