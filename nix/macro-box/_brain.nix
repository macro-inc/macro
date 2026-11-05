{ pkgs }:
let
  inherit (pkgs) lib;
  source = lib.fileset.toSource {
    root = ../..;
    fileset = lib.fileset.unions [
      ../../packages/brain/deno.json
      ../../packages/brain/deno.lock
      ../../packages/brain/src
      ../../packages/sdk/src
    ];
  };
  # Deno downloads a separate denort for compile. Capture it alongside npm/jsr
  # dependencies, then compile offline in a normal sandboxed derivation.
  dependencies = pkgs.stdenvNoCC.mkDerivation {
    name = "macro-brain-dependencies";
    src = source;
    nativeBuildInputs = [ pkgs.deno pkgs.cacert ];
    dontFixup = true;
    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash = lib.fakeHash;
    buildPhase = ''
      export HOME=$TMPDIR/home DENO_DIR=$out/cache
      mkdir -p "$HOME" "$DENO_DIR"
      cd packages/brain
      deno task compile --frozen
    '';
    installPhase = ''
      mkdir -p $out
      cp -a node_modules $out/node_modules
      # SQLite caches and logs carry timestamps; only download content is input.
      find $out/cache -maxdepth 1 -type f -delete
    '';
  };
in
pkgs.stdenvNoCC.mkDerivation {
  pname = "macro-brain";
  version = "0.1.0";
  src = source;
  nativeBuildInputs = [ pkgs.deno ];
  buildPhase = ''
    export HOME=$TMPDIR/home DENO_DIR=$TMPDIR/deno
    mkdir -p "$HOME"
    cp -a ${dependencies}/cache "$DENO_DIR"
    chmod -R u+w "$DENO_DIR"
    cd packages/brain
    cp -a ${dependencies}/node_modules .
    chmod -R u+w node_modules
    deno task compile --cached-only --frozen
  '';
  installPhase = ''
    install -Dm755 dist/brain $out/bin/brain
  '';
  passthru = { inherit dependencies; };
}
