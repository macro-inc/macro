{
  pkgs,
  crane,
  fenix,
}:
let
  toolchain = fenix.packages.${pkgs.stdenv.hostPlatform.system}.fromToolchainFile {
    file = ../../rust-toolchain.toml;
    sha256 = "sha256-qqF33vNuAdU5vua96VKVIwuc43j4EFeEXbjQ6+l4mO4=";
  };
  craneLib = (crane.mkLib pkgs).overrideToolchain toolchain;
  src = pkgs.lib.cleanSourceWith {
    src = ../..;
    filter =
      path: type:
      let
        rel = pkgs.lib.removePrefix (toString ../.. + "/") (toString path);
        unrelated = builtins.any (prefix: rel == prefix || pkgs.lib.hasPrefix (prefix + "/") rel) [
          ".agents"
          "docs"
          "infra"
        ];
        guidance = builtins.elem (baseNameOf path) [
          "AGENTS.md"
          "CLAUDE.md"
          "CODING.md"
        ];
      in
      !unrelated
      && !guidance
      && (
        craneLib.filterCargoSources path type
        || builtins.match ".*\\.(sql|pem|md|html|txt|json|sh|proto)$" path != null
      );
  };
in
craneLib.buildPackage {
  pname = "macro-kubernetes-bootstrap";
  version = "0.1.0";
  inherit src;
  cargoExtraArgs = "-p xtask_local --features local-stack";
  cargoVendorDir = craneLib.vendorCargoDeps {
    src = ../..;
    cargoLock = ../../Cargo.lock;
    outputHashes = import ../../nix-support/root-cargo-output-hashes.nix;
  };
  nativeBuildInputs = [
    pkgs.cmake
    pkgs.pkg-config
    pkgs.git
  ];
  buildInputs = [
    pkgs.openssl
    pkgs.curl.dev
  ];
  OPENSSL_NO_VENDOR = "1";
  doCheck = false;
}
