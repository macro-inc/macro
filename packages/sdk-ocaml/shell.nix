# Toolchain for packages/sdk-ocaml: the compiler, dune, findlib and yojson for
# the client; bun for the generator and the proxy; curl for poking at the
# proxy by hand.
#   nix-shell packages/sdk-ocaml/shell.nix --run 'cd packages/sdk-ocaml && bun generator/generate.ts && dune build @install && dune test'
{ pkgs ? import <nixpkgs> { } }:
let
  ocamlPackages = pkgs.ocaml-ng.ocamlPackages_5_4 or pkgs.ocamlPackages;
in
pkgs.mkShell {
  packages = [
    ocamlPackages.ocaml
    ocamlPackages.dune_3
    ocamlPackages.findlib
    ocamlPackages.yojson
    pkgs.bun
    pkgs.curl
  ];
}
