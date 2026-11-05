#!/bin/sh
# Runs cmake, then removes its configure log, which records timings and so differs on every run.
# Build scripts' whole output directory feeds later actions, so one changed file misses the cache.
set -e
cmake "$@"
rm -f CMakeFiles/CMakeConfigureLog.yaml
