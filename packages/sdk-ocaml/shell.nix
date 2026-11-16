# Development shell for the OCaml SDK:
#   nix-shell packages/sdk-ocaml/shell.nix --run "cd packages/sdk-ocaml && dune build && dune test"
# The Wasm transport (fetch/) also needs wasm_of_ocaml, binaryen and Deno:
#   nix-shell packages/sdk-ocaml/shell.nix --run "cd packages/sdk-ocaml && dune build --profile wasm @fetch/runtest"
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
  # The Deno code mode runs (crates/code_execution DENO_VERSION), as the
  # official release binary: nixpkgs has an older 2.9.
  deno =
    let
      version = "2.9.6";
      releases = {
        x86_64-linux = {
          target = "x86_64-unknown-linux-gnu";
          sha256 = "1cplvxv2d5r5zv1zmqrmijq2k6s22vxf0z0ydz7fdsrbvbs0fkrr";
        };
        aarch64-linux = {
          target = "aarch64-unknown-linux-gnu";
          sha256 = "0vh43ir15iq8d6lgg1qfim04cnsl6n4mac8sywpwviwjqg3ayils";
        };
        aarch64-darwin = {
          target = "aarch64-apple-darwin";
          sha256 = "0wm40xcg7f6ymdi0ks0zmdd0mxiqs7x9lri0ab5wklq49wq2yfi1";
        };
        x86_64-darwin = {
          target = "x86_64-apple-darwin";
          sha256 = "0przaclp7lfmi9p04a2vms9bjhpdarlvb9d143h7ymfc5fw28ibx";
        };
      };
      release = releases.${pkgs.stdenv.hostPlatform.system};
    in
    pkgs.stdenv.mkDerivation {
      pname = "deno";
      inherit version;
      src = pkgs.fetchurl {
        url = "https://github.com/denoland/deno/releases/download/v${version}/deno-${release.target}.zip";
        inherit (release) sha256;
      };
      nativeBuildInputs = [ pkgs.unzip ] ++ pkgs.lib.optional pkgs.stdenv.isLinux pkgs.autoPatchelfHook;
      buildInputs = pkgs.lib.optional pkgs.stdenv.isLinux pkgs.stdenv.cc.cc.lib;
      sourceRoot = ".";
      installPhase = "install -Dm755 deno $out/bin/deno";
    };
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
    # macro_sdk_fetch (dune --profile wasm): wasm_of_ocaml runs wasm-opt
    # from binaryen; its tests run under Deno.
    ocamlPackages.js_of_ocaml
    ocamlPackages.wasm_of_ocaml-compiler
    pkgs.binaryen
    deno
  ];
}
