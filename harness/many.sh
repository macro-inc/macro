#!/usr/bin/env bash
for i in $(seq "$2" "$3"); do ~/.cache/channels-perf-b/run.sh "$1$i"; done
