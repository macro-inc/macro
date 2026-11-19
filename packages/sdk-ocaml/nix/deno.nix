# The Deno code mode runs (crates/code_execution DENO_VERSION), as the
# official release binary: nixpkgs has an older 2.9. Used by shell.nix and
# the code-mode bundle check (nix/cloud-storage.nix).
{
  lib,
  stdenv,
  fetchurl,
  unzip,
  autoPatchelfHook,
}:
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
  release = releases.${stdenv.hostPlatform.system};
in
stdenv.mkDerivation {
  pname = "deno";
  inherit version;
  src = fetchurl {
    url = "https://github.com/denoland/deno/releases/download/v${version}/deno-${release.target}.zip";
    inherit (release) sha256;
  };
  nativeBuildInputs = [ unzip ] ++ lib.optional stdenv.isLinux autoPatchelfHook;
  buildInputs = lib.optional stdenv.isLinux stdenv.cc.cc.lib;
  sourceRoot = ".";
  installPhase = "install -Dm755 deno $out/bin/deno";
}
