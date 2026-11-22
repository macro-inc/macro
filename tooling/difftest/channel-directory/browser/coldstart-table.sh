#!/usr/bin/env bash
# One row per viewer, build, cache mode and load from a cold-start matrix dir.
#   table.sh <matrix-dir>   -> TSV on stdout, JSON rows in <matrix-dir>/table.json
# lane      = SoupChannelDirectoryBackfill/SoupBackfill channel-lane pages (cache on)
# pages     = ChannelDirectoryPage requests (the same soup query paged into memory, cache off)
# pageAll   = channel_directory.page_all spans (one per in-memory directory fill)
# doneMs    = when the directory first reported itself complete: the refresh span with
#             complete=true (cache on) or the end of the first page_all (cache off)
set -euo pipefail
dir="$1"
rows=()
for run in "$dir"/*/run.json; do
  name="$(basename "$(dirname "$run")")"
  rows+=("$(jq -c --arg name "$name" '
    ($name | split("-")) as $p
    | .summaries[] as $s
    | ($s.spans | map(select(.name == "channel_directory.refresh"))) as $refresh
    | ($refresh | map(select(.attributes["channel_directory.complete"] == true)) | sort_by(.startMs + .durationMs) | first) as $done
    | ($s.spans | map(select(.name == "channel_directory.page_all")) | sort_by(.startMs)) as $pageAll
    | {
        viewer: $p[0], build: $p[1], cache: $p[2], load: $s.load,
        restRequests: $s.rest.requests, restBytes: $s.rest.bytes,
        activity: $s.activity.requests,
        laneRequests: $s.lane.requests, laneBytes: $s.lane.bytes,
        laneLastEndMs: $s.lane.lastEndMs,
        pageRequests: ($s.operations.ChannelDirectoryPage // 0),
        pageAllSpans: ($pageAll | length),
        byIdRequests: $s.byId.requests,
        doneMs: (if $done then ($done.startMs + $done.durationMs)
                 elif ($pageAll | length) > 0 then ($pageAll[0].startMs + $pageAll[0].durationMs)
                 else null end),
        records: (if $done then $done.attributes["channel_directory.records"]
                  elif ($pageAll | length) > 0 then $pageAll[0].attributes["channel_directory.channels"]
                  else null end)
      }' "$run")")
done
printf '%s\n' "${rows[@]}" | jq -s 'sort_by(.viewer, .build, .cache, .load)' > "$dir/table.json"
jq -r '(["viewer","build","cache","load","rest","restMB","activity","lane","laneMB","laneEndMs","pages","pageAll","byId","doneMs","records"] | @tsv),
  (.[] | [.viewer,.build,.cache,.load,.restRequests,((.restBytes/1e6*100|round)/100),.activity,.laneRequests,((.laneBytes/1e6*100|round)/100),.laneLastEndMs,.pageRequests,.pageAllSpans,.byIdRequests,.doneMs,.records] | @tsv)' "$dir/table.json"
