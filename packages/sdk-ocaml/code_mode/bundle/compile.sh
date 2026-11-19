#!/usr/bin/env bash
# Per-execution compile of a code-mode OCaml program against this bundle:
# the fixed command lines the harness runs, no dune, no ocamlfind. This is
# the reference; code mode's compile step runs the same three commands.
#   PATH=<bundle>/bin:<coreutils> compile.sh <dir>
# <dir> holds main.ml and becomes the working directory; it gets main.js
# (the loader) and main.assets/ with only the program's own modules, since
# the library modules are in <bundle>/assets under the same names.
# Prints the time of each step to stderr.
set -euo pipefail
bundle=$(cd "${BASH_SOURCE[0]%/*}" && pwd)
lib=$bundle/lib
cd "$1"
# wasm_of_ocaml writes temporary files under TMPDIR, reads the bundle's
# findlib configuration (only the stdlib package) and runs the binaryen tools
# through /bin/sh.
export TMPDIR=$PWD OCAMLFIND_CONF=$bundle/findlib/findlib.conf
now() { local t; t=$EPOCHREALTIME; echo "${t/./}"; }

t0=$(now)
# 1. Type-check and compile against the bundle's .cmi files only.
ocamlc -nostdlib -I "$bundle/stdlib" -I "$bundle/cmi" -c main.ml
t1=$(now)
# 2. The program's one unit to Wasm, with the libraries' shapes.
shapes=()
while read -r name; do shapes+=(--load-shape "$lib/$name"); done < "$lib/shapes.txt"
wasm_of_ocaml compile --effects=jspi --no-sourcemap -o main.wasmo main.cmo "${shapes[@]}"
t2=$(now)
# 3. Link against the prebuilt archives.
archives=()
while read -r name; do archives+=("$lib/$name"); done < "$lib/link.txt"
wasm_of_ocaml link --no-sourcemap -o main.js "${archives[@]}" main.wasmo "$lib/std_exit.wasmo"
t3=$(now)
# 4. Keep only the program's own modules; the bundle serves the rest.
for f in main.assets/*.wasm; do
  if [[ -e $bundle/assets/${f##*/} ]]; then rm "$f"; fi
done
rm -f main.cmi main.cmo main.wasmo
echo "ocamlc_ms=$(( (t1 - t0) / 1000 )) compile_ms=$(( (t2 - t1) / 1000 )) link_ms=$(( (t3 - t2) / 1000 )) total_ms=$(( (t3 - t0) / 1000 ))" >&2
