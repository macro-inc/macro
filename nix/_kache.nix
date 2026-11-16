# kache, the Rust compiler cache local dev shells use (not in nixpkgs). The
# release binaries are static on Linux, so they run as shipped.
{
  stdenvNoCC,
  fetchurl,
  lib,
}:
let
  version = "2.1.1";
  targets = {
    x86_64-linux = {
      triple = "x86_64-unknown-linux-musl";
      hash = "sha256-dgMCLueLSKmv3pBVsN8n5cLO8TUaVPot5rT94PN64iw=";
    };
    aarch64-linux = {
      triple = "aarch64-unknown-linux-musl";
      hash = "sha256-Rm8K70iF9SkTWbPBvAyZdoJGNBlMW2fhzuKk/jA1FVo=";
    };
    x86_64-darwin = {
      triple = "x86_64-apple-darwin";
      hash = "sha256-aWJ8/sMBeqUh0GqEr8bF50c0RoZ4vWZZ2Sr9V9mk9Fc=";
    };
    aarch64-darwin = {
      triple = "aarch64-apple-darwin";
      hash = "sha256-1FM7qjxXvlHV8jkLcFUcqdbCqDoZMyZvoKVwU3dOCPY=";
    };
  };
  target =
    targets.${stdenvNoCC.hostPlatform.system}
      or (throw "kache: no release binary for ${stdenvNoCC.hostPlatform.system}");
in
stdenvNoCC.mkDerivation {
  pname = "kache";
  inherit version;
  src = fetchurl {
    url = "https://github.com/kunobi-ninja/kache/releases/download/v${version}/kache-${target.triple}.tar.gz";
    inherit (target) hash;
  };
  sourceRoot = ".";
  dontConfigure = true;
  dontBuild = true;
  dontFixup = true;
  installPhase = ''
    runHook preInstall
    # kache runs kache-engine from its own directory.
    install -Dm755 kache kache-engine -t "$out/bin"
    runHook postInstall
  '';
  meta = {
    description = "Compiler cache for Rust";
    homepage = "https://github.com/kunobi-ninja/kache";
    license = lib.licenses.asl20;
    mainProgram = "kache";
    platforms = builtins.attrNames targets;
  };
}
