#!/usr/bin/env bash
# steperr.sh <trace.zip>: the last error of each failed expect in a trace, colours removed, plus step times.
unzip -p "$1" test.trace | jq -r 'select(.type=="after" and .error!=null and (.callId|test("^expect@"))) | "\(.endTime)\t\(.error.message)"' | sed 's/\x1b\[[0-9;]*m//g' | tail -${N:-22}
