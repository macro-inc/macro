{ pkgs }:
let
  inherit (pkgs) lib;
  source = lib.fileset.toSource {
    root = ../..;
    fileset = lib.fileset.unions [
      ../../packages/brain/deno.json
      ../../packages/brain/deno.lock
      ../../packages/brain/compile.sh
      ../../packages/brain/src
      # Endpoint coverage bookkeeping is not imported by the brain.
      (lib.fileset.difference ../../packages/sdk/src ../../packages/sdk/src/coverage)
      ../../packages/sdk/generated
    ];
  };
  # Fetch the lockfile graph once; compilation below has no network access.
  dependencies = pkgs.stdenvNoCC.mkDerivation {
    name = "macro-brain-dependencies";
    src = source;
    nativeBuildInputs = [
      pkgs.deno
      pkgs.cacert
    ];
    dontFixup = true;
    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash = "sha256-utzVBDqJcGvdPrGNpNadJi34eqwpQzK9fKWHD5GejKE=";
    buildPhase = ''
      export HOME=$TMPDIR/home DENO_DIR=$out/cache
      mkdir -p "$HOME" "$DENO_DIR"
      cd packages/brain
      deno cache --frozen src/main.ts
    '';
    installPhase = ''
      mkdir -p $out
      cp -a node_modules $out/node_modules
      # SQLite caches and logs carry timestamps; only download content is input.
      find $out/cache -maxdepth 1 -type f -delete
    '';
  };
  compiled = pkgs.stdenvNoCC.mkDerivation {
    __structuredAttrs = true;
    pname = "macro-brain-compiled";
    version = "0.1.0-${builtins.substring 0 12 (builtins.hashString "sha256" (toString source))}";
    src = source;
    nativeBuildInputs = [ pkgs.deno ];
    dontFixup = true;
    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash = "sha256-sli4jhwXpS/L1NWbbZcifFghFXHRpW98w35Er9RDLvA=";
    # FODs cannot retain store references. The final package below rediscovers
    # the denort runtime closure after copying the hash-verified binary.
    unsafeDiscardReferences.out = true;
    buildPhase = ''
      export DENORT_BIN=${pkgs.deno.denort}/bin/denort
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
  };
in
pkgs.runCommand "macro-brain-0.1.0"
  {
    runtime = pkgs.deno.denort;
    passthru = { inherit dependencies compiled; };
  }
  ''
    mkdir -p $out/bin
    cp ${compiled}/bin/brain $out/bin/brain
  ''
