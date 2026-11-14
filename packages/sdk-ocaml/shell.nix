# Development shell for the OCaml SDK:
#   nix-shell packages/sdk-ocaml/shell.nix --run "cd packages/sdk-ocaml && dune build && dune test"
{ pkgs ? import <nixpkgs> { } }:
let
  ocamlPackages = pkgs.ocamlPackages;
in
pkgs.mkShell {
  packages = [
    pkgs.just
    ocamlPackages.ocaml
    ocamlPackages.dune_3
    ocamlPackages.findlib
    pkgs.ocamlformat
    # macro_sdk
    ocamlPackages.yojson
    ocamlPackages.uri
    # generator
    ocamlPackages.ppxlib
    # macro_sdk_eio
    ocamlPackages.eio
    ocamlPackages.eio_main
    ocamlPackages.cohttp-eio
    ocamlPackages.tls-eio
    ocamlPackages.ca-certs
    ocamlPackages.mirage-crypto-rng
    ocamlPackages.domain-name
  ];
}
