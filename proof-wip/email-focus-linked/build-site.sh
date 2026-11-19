#!/usr/bin/env bash
# Build the proof site from proof/page.html: fill the placeholders, inline the
# player CSS, copy the recordings and redacted logs.
# Usage: build-site.sh "<CI status html>"
set -euo pipefail
S=$(cd "$(dirname "$0")" && pwd)
OUT=$S/site
CI=$1
mkdir -p "$OUT"
redact() { sed -e "s#$S#scratch#g" -e 's#/home/teo#~#g' -e 's#synoet-email-focus-linked#email-focus-linked#g' -e 's#solaris[a-z0-9.-]*#<host>#g' -e 's#postgres://[^ @]*@#postgres://<redacted>@#g'; }
awk -v css="$S/proof/player.css" '
  /\/\*PLAYER_CSS\*\// { while ((getline line < css) > 0) print line; next }
  { print }' "$S/proof/page.html" \
  | sed -e 's#{{PR_URL}}#https://github.com/macro-inc/macro/pull/11501#g' \
        -e 's#{{PR_NUMBER}}#11501#g' -e 's#{{FIX}}#0013592414a#g' \
        -e 's#{{HEAD}}#0013592414a#g' \
        -e 's#{{DIFFD}}#https://solaris.tail913c08.ts.net:3433/r/ev648xezep#g' \
  | CI="$CI" awk '{ gsub(/\{\{CI\}\}/, ENVIRON["CI"]); print }' > "$OUT/index.html"
cp "$S/proof/before.cast" "$S/proof/after.cast" "$S/proof/mutant.cast" "$S/proof/mutation.diff" "$OUT/"
redact < "$S/test-email-2.log" > "$OUT/test-email.txt"
redact < "$S/test-worker-2.log" > "$OUT/test-worker.txt"
redact < "$S/e2e-branch.log" > "$OUT/e2e-branch.txt"
redact < "$S/mutation-email.log" > "$OUT/mutation-email.txt"
redact < "$S/mutation-worker.log" > "$OUT/mutation-worker.txt"
redact < "$S/mutation-review.log" > "$OUT/mutation-review.txt"
redact < "$S/plans/fresh.txt" > "$OUT/plans-fresh.txt"
redact < "$S/plans/stale.txt" > "$OUT/plans-stale.txt"
redact < "$S/plans/seed.sql" > "$OUT/seed.sql"
grep -c '{{' "$OUT/index.html" || true
grep -l "/home/teo\|synoet\|claude-1001\|solaris\.\|postgres://[^<]" "$OUT"/* || echo "clean"
# The tailnet server serves the file as is, without the Artifact's skeleton.
mkdir -p "$S/site-tailnet"
cp "$OUT"/* "$S/site-tailnet/"
{ printf '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>\n'; cat "$OUT/index.html"; printf '\n</body></html>\n'; } > "$S/site-tailnet/index.html"
