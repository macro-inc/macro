#!/usr/bin/env bash
# N concurrent restored clones of one template: memory per clone and for the
# host, once every clone answers on vsock and has idled for SETTLE seconds.
# Run it under the host's timed lock; it brings all N up, then tears them down.
#
#   fanout.sh <backend> <variant> <n> <out dir>
#
# Appends one JSON line to <out>/fanout-<backend>-<variant>-<n>.jsonl:
# per-clone {name, up timings, t_responsive, mem}, plus host MemAvailable,
# Cached and AnonPages before and after, so shared page cache shows up once.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
backend=$1 variant=$2 n=$3 out=$4
b=$here/backends/$backend.sh
SETTLE=${SETTLE:-30}
TIMEOUT=${TIMEOUT:-300}
# Restored clones all keep the template's MAC and IP: keep them off the bridge.
export ISOLATED=1
mkdir -p "$out"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

meminfo() {
  awk '/^(MemAvailable|Cached|AnonPages|Shmem):/ { gsub(":", "", $1); printf "%s\"%s_kib\":%d", (n++ ? "," : "{"), $1, $2 } END { print "}" }' /proc/meminfo
}

for i in $(seq 1 "$n"); do "$b" down "f-$variant-$i" >/dev/null 2>&1 || true; done
before=$(meminfo)
t0=$(date +%s.%N)
for i in $(seq 1 "$n"); do
  name=f-$variant-$i
  mac=$(printf '52:54:00:dd:f0:%02x' "$i")
  "$b" up "$variant" "$name" "$mac" > "$work/$name.up"
done
t_all_up=$(date +%s.%N)
for i in $(seq 1 "$n"); do
  name=f-$variant-$i
  deadline=$(( $(date +%s) + TIMEOUT ))
  until "$b" exec "$name" 'echo up' 2>/dev/null | grep -qx up; do
    [ "$(date +%s)" -gt "$deadline" ] && { echo "$name never answered" >&2; break; }
    sleep 0.05
  done
  date +%s.%N > "$work/$name.resp"
done
t_all_responsive=$(date +%s.%N)
sleep "$SETTLE"
after=$(meminfo)
clones=$(for i in $(seq 1 "$n"); do
  name=f-$variant-$i
  jq -c --arg name "$name" --argjson resp "$(cat "$work/$name.resp")" --argjson mem "$("$b" mem "$name")" \
    '{name: $name, up: ., t_responsive: $resp, mem: $mem}' "$work/$name.up"
done | jq -sc .)
for i in $(seq 1 "$n"); do "$b" down "f-$variant-$i" >/dev/null 2>&1 || true; done
jq -cn --arg backend "$backend" --arg variant "$variant" --argjson n "$n" \
  --argjson t0 "$t0" --argjson up "$t_all_up" --argjson resp "$t_all_responsive" \
  --argjson before "$before" --argjson after "$after" --argjson clones "$clones" \
  '{backend: $backend, variant: $variant, n: $n, t_start: $t0, t_all_up: $up, t_all_responsive: $resp,
    host_before: $before, host_after: $after, clones: $clones}' |
  tee -a "$out/fanout-$backend-$variant-$n.jsonl" |
  jq -c '{variant, n, wall_up: (.t_all_up - .t_start), wall_responsive: (.t_all_responsive - .t_start),
    per_clone_mib: {rss: ([.clones[].mem.rss_kib] | add / length / 1024 | round),
                    pss: ([.clones[].mem.pss_kib] | add / length / 1024 | round),
                    anon: ([.clones[].mem.anon_kib] | add / length / 1024 | round),
                    private_dirty: ([.clones[].mem.private_dirty_kib] | add / length / 1024 | round)},
    host_used_delta_mib: ((.host_before.MemAvailable_kib - .host_after.MemAvailable_kib) / 1024 | round)}'
