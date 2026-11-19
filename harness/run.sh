#!/usr/bin/env bash
# run.sh <tag> [playwright args]: suite run + whether the host ARP table overflowed during it
tag=$1; shift
start=$(date '+%Y-%m-%d %H:%M:%S')
~/.cache/channels-perf-b/suite.sh "$tag" "$@" 2>&1 | grep -v socat > ~/.cache/channels-perf-b/e2e/$tag.out
end=$(date '+%Y-%m-%d %H:%M:%S')
ovf=$(journalctl -k --since "$start" --until "$end" 2>/dev/null | grep -c "neighbor table overflow")
echo "== $tag $start..$end arp_overflow_lines=$ovf"
grep -E "^\s+[0-9]+ (failed|passed|flaky|skipped|did not run)" ~/.cache/channels-perf-b/e2e/$tag.out
grep -E "^\s+tests/.*›" ~/.cache/channels-perf-b/e2e/$tag.out | sed -E 's/ ─+$//' | sort | uniq -c
