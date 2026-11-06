{
  pkgs,
  crane,
  fenix,
  packages,
}:
let
  toolchain = fenix.packages.${pkgs.stdenv.hostPlatform.system}.fromToolchainFile {
    file = ../../rust-toolchain.toml;
    sha256 = "sha256-qqF33vNuAdU5vua96VKVIwuc43j4EFeEXbjQ6+l4mO4=";
  };
  craneLib = (crane.mkLib pkgs).overrideToolchain toolchain;
in
craneLib.mkCargoDerivation {
  cargoArtifacts = null;
  doInstallCargoArtifacts = false;
  pname = "macro-sync-worker";
  version = "1";
  src = pkgs.lib.cleanSourceWith {
    src = ../..;
    filter =
      path: type:
      craneLib.filterCargoSources path type
      || builtins.match ".*\\.(toml|ts|json|sql|bop|lock)$" path != null;
  };
  cargoVendorDir = craneLib.vendorCargoDeps {
    src = ../..;
    cargoLock = ../../Cargo.lock;
    outputHashes = import ../../nix-support/root-cargo-output-hashes.nix;
  };
  nativeBuildInputs = [
    pkgs.worker-build
    pkgs.wasm-pack
    pkgs.wasm-bindgen-cli_0_2_126
    pkgs.clang
    pkgs.bun
    pkgs.nodejs
  ];
  WASM_BINDGEN_BIN = "${pkgs.wasm-bindgen-cli_0_2_126}/bin/wasm-bindgen";
  WASM_BINDGEN_TEST_RUNNER_BIN = "${pkgs.wasm-bindgen-cli_0_2_126}/bin/wasm-bindgen-test-runner";
  ESBUILD_BIN = "${pkgs.esbuild}/bin/esbuild";
  WASM_OPT_BIN = "${pkgs.binaryen}/bin/wasm-opt";
  buildPhaseCargoCommand = ''
    export HOME=$TMPDIR XDG_CACHE_HOME=$TMPDIR/cache
    cp -r ${packages.macro-js-node-modules}/node_modules .
    chmod -R u+w node_modules
    export PATH=$PWD/node_modules/.bin:$PATH
    cd services/sync-service
    worker-build --profile sync-service-release
  '';
  installPhaseCommand = ''
    mkdir -p $out
    cp -r build database $out/
    sed 's/document_storage_service/document-storage-service/g' wrangler.docker.toml > $out/wrangler.toml
  '';
  doCheck = false;
}
