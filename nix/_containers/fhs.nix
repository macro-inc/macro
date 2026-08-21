# FHS dynamic linker for zigbuild binaries.
#
# Host `cargo zigbuild` links against `/lib64/ld-linux-*.so.2` (or `/lib` on
# aarch64). A pure Nix store layout does not provide that path, so the runtime
# image plants a symlink next to the real glibc `ld.so` already copied in via
# `copyToRoot`.
{ pkgs }:
let
  fhsLinker = pkgs.stdenv.cc.bintools.dynamicLinker;
  storeLinker = "${pkgs.glibc}/lib/${baseNameOf fhsLinker}";
in
{
  inherit fhsLinker storeLinker;
  extraCommands = ''
    mkdir -p .${dirOf fhsLinker} ./app ./lib ./lib64
    ln -s ${storeLinker} .${fhsLinker}
  '';
}
