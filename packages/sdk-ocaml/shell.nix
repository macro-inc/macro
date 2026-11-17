# Development shell for the OCaml SDK:
#   nix-shell packages/sdk-ocaml/shell.nix --run "cd packages/sdk-ocaml && dune build && dune test"
# Uses the nixpkgs revision pinned in the repository's flake.lock, so CI and
# every checkout get the same OCaml, ocamlformat and libraries (the generated
# sources depend on the ocamlformat and ppxlib versions).
let
  locked = (builtins.fromJSON (builtins.readFile ../../flake.lock)).nodes.nixpkgs.locked;
  pinned = fetchTarball {
    url = "https://github.com/${locked.owner}/${locked.repo}/archive/${locked.rev}.tar.gz";
    sha256 = locked.narHash;
  };
in
{ pkgs ? import pinned { } }:
let
  ocamlPackages = pkgs.ocamlPackages;
in
pkgs.mkShell {
  packages = [
    pkgs.just
    pkgs.ocamlformat
    ocamlPackages.ocaml
    ocamlPackages.dune_3
    ocamlPackages.findlib
    # macro_sdk
    ocamlPackages.yojson
    ocamlPackages.uri
    # generator
    ocamlPackages.ppxlib
    # macro_sdk_eio
    ocamlPackages.eio
    ocamlPackages.eio_main
    ocamlPackages.cohttp-eio
    ocamlPackages.http
    ocamlPackages.tls
    ocamlPackages.tls-eio
    ocamlPackages.x509
    ocamlPackages.ca-certs
    ocamlPackages.mirage-crypto-rng
    ocamlPackages.mirage-crypto-pk
    ocamlPackages.domain-name
    ocamlPackages.ipaddr
    ocamlPackages.ptime
  ];
}
