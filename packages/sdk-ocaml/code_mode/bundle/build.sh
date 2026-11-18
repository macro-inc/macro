#!/usr/bin/env bash
# Builds code mode's prebuilt OCaml bundle into <out> (README "Code mode
# bundle"): the SDK, its dependencies, Macro_sdk_fetch and Code_mode as
# wasm_of_ocaml archives (--effects=jspi), the .cmi files programs compile
# against, the prebuilt library modules, the run-time toolchain and the SDK
# fingerprint. Run from packages/sdk-ocaml with dune, ocamlfind, ocamlc,
# wasm_of_ocaml and binaryen on PATH (nix: .#code-mode-ocaml; or shell.nix).
#   code_mode/bundle/build.sh <out>
set -euo pipefail
out=$1
sdk=$(pwd)
mkdir -p "$out"
out=$(cd "$out" && pwd)
mkdir -p "$out/bin" "$out/lib" "$out/cmi" "$out/assets"

# Bytecode archives and .cmi files of the SDK, the transport and Code_mode.
build=$(mktemp -d)
dune build --root . --profile wasm --build-dir "$build" \
  ./runtime/macro_sdk_runtime.cma ./generated/macro_sdk.cma \
  ./fetch/macro_sdk_fetch.cma ./code_mode/code_mode.cma \
  ./code_mode/policy/code_mode_policy.exe ./analyzer/bin/macro_sdk_calls.exe
b=$build/default

# What a program may see: the SDK, its runtime, yojson, uri, the transport
# and Code_mode. Not js_of_ocaml: programs cannot name the JavaScript
# interop. The standard library comes from ocamlc's own directory.
cp "$b"/runtime/.macro_sdk_runtime.objs/byte/*.cmi \
  "$b"/generated/.macro_sdk.objs/byte/*.cmi \
  "$b"/fetch/.macro_sdk_fetch.objs/byte/*.cmi \
  "$b"/code_mode/.code_mode.objs/byte/*.cmi \
  "$(ocamlfind query yojson)"/*.cmi "$(ocamlfind query uri)"/*.cmi \
  "$out/cmi/"

# Every archive, in link order: the standard library, the third-party
# libraries in dependency order, then ours.
archives=("$(ocamlc -where)/stdlib.cma")
while read -r dir names; do
  for name in $names; do archives+=("$dir/$name"); done
done < <(ocamlfind query -r -predicates byte -format '%d %a' yojson uri js_of_ocaml)
archives+=("$b/runtime/macro_sdk_runtime.cma" "$b/generated/macro_sdk.cma"
  "$b/fetch/macro_sdk_fetch.cma" "$b/code_mode/code_mode.cma")

# The Wasm runtime, with the transport's additions (fetch/dune).
flags=(--effects=jspi --no-sourcemap)
wasm_of_ocaml build-runtime "${flags[@]}" -o "$out/lib/runtime.wasma" \
  fetch/bigstringaf.wat fetch/await.wat fetch/await.js
echo runtime.wasma > "$out/lib/link.txt"
: > "$out/lib/shapes.txt"
shapes=()
for cma in "${archives[@]}"; do
  name=$(basename "$cma" .cma).wasma
  wasm_of_ocaml compile "${flags[@]}" -o "$out/lib/$name" "$cma" "${shapes[@]}"
  shapes+=(--load-shape "$out/lib/$name")
  echo "$name" >> "$out/lib/link.txt"
  echo "$name" >> "$out/lib/shapes.txt"
done
wasm_of_ocaml compile "${flags[@]}" -o "$out/lib/std_exit.wasmo" "$(ocamlc -where)/std_exit.cmo"

# The run-time toolchain: ocamlc, wasm_of_ocaml and the binaryen tools it
# runs, the policy check (code_mode/policy) the harness runs on each
# program's typed tree, and the analyzer (analyzer/) that lists the SDK
# operations a program may call, for the permission gate. A compile
# child's PATH is this directory. ocamlc and wasm_of_ocaml
# are copies so the nix build can drop their references to the whole OCaml
# installation (about 700 MB with wasm_of_ocaml's build inputs): ocamlc
# reads the standard library's interfaces from stdlib/ (-nostdlib), and
# wasm_of_ocaml gets every archive by path.
cp "$(readlink -f "$(command -v ocamlc)")" "$out/bin/ocamlc"
cp "$(readlink -f "$(command -v wasm_of_ocaml)")" "$out/bin/wasm_of_ocaml"
install -m 755 "$b/code_mode/policy/code_mode_policy.exe" "$out/bin/code_mode_policy"
install -m 755 "$b/analyzer/bin/macro_sdk_calls.exe" "$out/bin/macro_sdk_calls"
rm -rf "$build"
chmod u+w "$out/bin/ocamlc" "$out/bin/wasm_of_ocaml"
for tool in wasm-opt wasm-merge wasm-metadce; do
  ln -s "$(readlink -f "$(command -v "$tool")")" "$out/bin/$tool"
done
mkdir -p "$out/stdlib" "$out/findlib/stdlib"
cp "$(ocamlc -where)"/*.cmi "$out/stdlib/"
# wasm_of_ocaml looks up findlib's stdlib package when it starts (it runs
# no ocamlfind and reads no other package): compile.sh points
# OCAMLFIND_CONF at this configuration, which knows only that one.
cp "$(ocamlc -where)/stdlib/META" "$out/findlib/stdlib/META"
printf 'path="%s"\nstdlib="%s"\nldconf="ignore"\n' "$out/findlib" "$out/stdlib" \
  > "$out/findlib/findlib.conf"
cp "$sdk/code_mode/bundle/compile.sh" "$out/compile.sh"
chmod +x "$out/compile.sh"

# The library modules, published once: wasm_of_ocaml link names each
# <library>-<content hash>.wasm, the same for every program, so a program's
# loader can read them from here. Link a program that uses every library
# (the linker leaves out unused ones) to produce them.
probe=$(mktemp -d)
echo 'let () = ignore Macro_sdk.Contacts.get_contacts; Code_mode.run (fun _ -> `Null)' > "$probe/main.ml"
PATH="$out/bin:$PATH" "$out/compile.sh" "$probe" 2>/dev/null
for f in "$probe"/main.assets/*.wasm; do
  case $(basename "$f") in
    main-*|start-*|_link_info.wasm) ;;
    *) cp "$f" "$out/assets/" ;;
  esac
done
rm -rf "$probe"
shopt -s nullglob
while read -r name; do
  found=("$out/assets/${name%.wasma}"-*.wasm)
  if (( ${#found[@]} != 1 )); then
    echo "build.sh: no prebuilt module for $name" >&2
    exit 1
  fi
done < "$out/lib/link.txt"

# The SDK fingerprint, like the TypeScript SDK's: its version plus a hash of
# the interfaces programs compile against. Source that compiled against one
# fingerprint compiles against any bundle with the same one; compiled Wasm
# belongs to the bundle (store path) that built it.
version=$(sed -n 's/^(version \(.*\))$/\1/p' dune-project)
hash=$(cd "$out/cmi" && LC_ALL=C ls | LC_ALL=C sort | xargs sha256sum | sha256sum | cut -c1-12)
printf '%s+%s\n' "$version" "$hash" > "$out/fingerprint"
