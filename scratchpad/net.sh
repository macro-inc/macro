#!/usr/bin/env bash
# net.sh <dir>: non-asset requests of every page trace after the participant removal, relative to it
cd "$1"
t0=$(for f in *-trace.network; do jq -r '.snapshot | select(.request.method=="DELETE") | ._monotonicTime|floor' $f; done | head -1)
echo "removal at $t0"
for f in *-trace.network; do
  jq -r --argjson t0 "$t0" '.snapshot | select(._monotonicTime > $t0-250) | select((.request.url|test("\\.js|\\.css|\\.woff|\\.svg|\\.png|comms/channels\\?")|not)) | [((._monotonicTime-$t0)|floor), .request.method, (.response.status|tostring), (.request.url|sub("https://localhost:[0-9]+";"")|.[0:80]), (.request.postData._sha1 // ""), (.response.content._sha1 // "")] | @tsv' $f | sort -n | while IFS=$'\t' read -r t m st u sha res; do
    op=""; [ -n "$sha" ] && op=$(jq -r '(.operationName // "")' resources/$sha 2>/dev/null | head -1)
    case "$op" in SoupBackfill|CalendarOccurrences|SoupMailBackfill|SoupSharedMailBackfill|ChannelTimeline) continue;; esac
    echo "$f $t $m $st $u $op :: $(head -c 90 resources/$res 2>/dev/null | tr '\n' ' ')"
  done
done | head -45
