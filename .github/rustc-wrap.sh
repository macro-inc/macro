#!/usr/bin/env bash
# Workspace crates compile directly, so cargo gets each rmeta as soon as rustc emits it.
# Everything else stays on sccache, which only returns once a crate has finished.
for a in "$@"; do
  case "$a" in
    /*) ;;
    *.rs) exec "$@" ;;
  esac
done
exec sccache "$@"
