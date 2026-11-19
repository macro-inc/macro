#!/usr/bin/env bash
# nettrace.sh <trace.zip> [op regex]: GraphQL requests in a trace whose operation matches, with time, status, failure; then console errors and page events.
t=$1; re=${2:-mutation (Send|Edit|Delete|ReactTo)ChannelMessage}
x=$HOME/.cache/channels-e2e-b/tmp/nt.$$; mkdir -p $x; unzip -q -o "$t" -d $x
for f in $x/*-trace.network; do
  jq -r 'select(.type=="resource-snapshot")|.snapshot|select(.request.url|test("graphql|/dss/messages/"))|[.startedDateTime[11:23],.request.method,(.response.status|tostring),(.response._failureText//"-"),(.request.postData._sha1//"-"),(.request.url|sub("https://[^/]+";"")|.[0:60]),(.pageref//"-"|.[5:11])]|@tsv' $f
done | sort | while IFS=$'\t' read -r at m st fail sha url pg; do
  op=-; [ "$sha" != - ] && [ -f "$x/resources/$sha" ] && op=$(grep -oE '(mutation|query|subscription) [A-Za-z]+' "$x/resources/$sha" | head -1)
  txt=""; [ "$sha" != - ] && [ -f "$x/resources/$sha" ] && txt=$(grep -oE '\\"content\\":\\"[^\\]*' "$x/resources/$sha" | head -1 | cut -c1-60)
  if echo "$op $m $url" | grep -qE "$re"; then printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$at" "$pg" "$st" "$fail" "${op:-$m}" "$txt" "$url"; fi
done
echo "-- console errors / page events"
cat $x/*-trace.trace | jq -r 'select(.type=="console" and (.messageType=="error" or (.text|test("Failed to fetch dynamically|chunk|reload";"i")))) | [(.time|tostring), .text[0:220]] | @tsv' 2>/dev/null | sort -n | uniq -f1 -c | head -${CON:-25}
rm -rf $x
