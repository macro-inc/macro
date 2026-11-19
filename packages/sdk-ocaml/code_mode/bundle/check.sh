#!/usr/bin/env bash
# Proves a program compiles against a built bundle with only the bundle's
# toolchain (ocamlc, wasm_of_ocaml, binaryen; no dune, no ocamlfind) and runs
# under Deno with code mode's flags, then reports per-program compile time
# and startup (process spawn until Code_mode.run reads its context), median
# of <runs> cold runs each. Needs deno (2.9.6) and coreutils on PATH.
#   code_mode/bundle/check.sh <bundle> [runs]
set -euo pipefail
bundle=$(cd "$1" && pwd)
runs=${2:-11}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
test=$here/../test
deno=$(command -v deno)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
export DENO_DIR=$work/deno-dir
deno --version | head -1

median() { sort -n | awk '{ a[NR] = $1 } END { print a[int((NR + 1) / 2)] }'; }
ms() { local t; t=$EPOCHREALTIME; t=${t/./}; echo $(( t / 1000 )); }

compiles=()
for i in $(seq "$runs"); do
  rm -rf "$work/scratch"; mkdir "$work/scratch"
  cp "$test/sample.ml" "$work/scratch/main.ml"
  # Only the bundle's toolchain, plus coreutils for compile.sh itself.
  t0=$(ms)
  env -i PATH="$bundle/bin:$(dirname "$(command -v rm)")" "$BASH" "$bundle/compile.sh" "$work/scratch" 2> "$work/compile.log"
  t1=$(ms)
  compiles+=("$(( t1 - t0 ))")
  if [[ $i == 1 ]]; then cat "$work/compile.log"; fi
done
echo "program files after compile:" $(cd "$work/scratch" && find . -type f | sort)
cp "$test/sample.expected.json" "$work/scratch/expected.json"

startups=(); totals=()
for i in $(seq "$runs"); do
  rm -rf "$DENO_DIR"
  t0=$(ms)
  line=$(cd "$work/scratch" && "$deno" run --no-prompt --no-config --no-lock --no-remote --no-npm \
    --deny-write --deny-env --deny-run --deny-ffi --deny-sys --deny-import \
    --allow-net=127.0.0.1 --allow-read="$work/scratch,$bundle/assets" \
    --v8-flags=--max-old-space-size=128 \
    "$test/run.mjs" main.js expected.json "$bundle/assets")
  t1=$(ms)
  main_at=$(sed -n 's/.*"main_at":\([0-9]*\).*/\1/p' <<< "$line")
  startups+=("$(( main_at - t0 ))"); totals+=("$(( t1 - t0 ))")
  if [[ $i == 1 ]]; then echo "frame: $line"; fi
done
echo "fingerprint: $(cat "$bundle/fingerprint")"
echo "compile (whole compile.sh, cold process) median: $(printf '%s\n' "${compiles[@]}" | median) ms of [${compiles[*]}]"
echo "startup (spawn to Code_mode.run) median: $(printf '%s\n' "${startups[@]}" | median) ms of [${startups[*]}]"
echo "whole run (spawn to exit, one call) median: $(printf '%s\n' "${totals[@]}" | median) ms of [${totals[*]}]"
