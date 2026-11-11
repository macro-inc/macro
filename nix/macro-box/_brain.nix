# The agent brain (packages/brain): Node 24, the versioned library and SDK
# source, and hash-pinned npm dependencies, behind a `brain` wrapper that
# supplies its own executable path, library root and health interval.
{ pkgs }:
let
  inherit (pkgs) lib;
  version = "0.2.0";
  source = lib.fileset.toSource {
    root = ../../packages/brain;
    fileset = lib.fileset.unions [
      ../../packages/brain/package.json
      ../../packages/brain/package-lock.json
      ../../packages/brain/tsconfig.json
      ../../packages/brain/src
    ];
  };
  sdkSource = lib.fileset.toSource {
    root = ../../packages/sdk;
    fileset = lib.fileset.unions [
      (lib.fileset.difference ../../packages/sdk/src ../../packages/sdk/src/coverage)
      ../../packages/sdk/generated
    ];
  };
in
pkgs.buildNpmPackage {
  pname = "macro-brain";
  inherit version;
  src = source;
  nodejs = pkgs.nodejs_24;
  npmDepsHash = "sha256-SUO3mPp8s/qBP5tVShj+wFUAcPIYeSXSZx76MNdwrSg=";
  npmFlags = [ "--ignore-scripts" ];
  dontNpmBuild = true;
  nativeBuildInputs = [
    pkgs.makeWrapper
    pkgs.esbuild
    pkgs.autoPatchelfHook
  ];
  buildInputs = [ pkgs.stdenv.cc.cc.lib ];
  # patchelf #639 corrupts libvips' low-address .init when expanding its RPATH.
  # Leave that bundled library intact; patch its addon and the other native files.
  dontAutoPatchelf = true;
  postFixup = ''
    for library in "$out/lib/brain/${version}/node_modules/@img/"sharp-libvips-*/lib; do
      addAutoPatchelfSearchPath "$library"
    done
    while IFS= read -r -d "" native; do
      autoPatchelf -- "$native"
    done < <(find "$out" -type f \( -name '*.node' -o -name ffmpeg \) -print0)
  '';
  doInstallCheck = true;
  installCheckPhase = ''
    ${pkgs.nodejs_24}/bin/node --input-type=module -e '
      const root = "'"$out"'/lib/brain/${version}/node_modules/@livekit/";
      const { inference } = await import(root + "agents/dist/index.js");
      const rtc = await import(root + "rtc-node/dist/index.js");
      if (!inference.STT || !inference.TTS) throw new Error("missing inference SDK");
      const source = new rtc.AudioSource(24000, 1);
      source.close();
      await rtc.dispose();
    '
  '';

  buildPhase = ''
    runHook preBuild
    # Vendor the fixed SDK at image build time. Workspace brain.ts runs directly.
    esbuild ${sdkSource}/src/macro.ts --bundle --format=esm --platform=node \
      --packages=external --outfile=vendor/macro-sdk.js
    runHook postBuild
  '';
  installPhase = ''
    runHook preInstall
    library=$out/lib/brain/${version}
    mkdir -p "$library" $out/bin $out/lib/brain/sdk
    cp -r src package.json package-lock.json tsconfig.json node_modules vendor "$library/"
    cp -r ${sdkSource}/src ${sdkSource}/generated $out/lib/brain/sdk/
    ln -s ../${version}/node_modules $out/lib/brain/sdk/node_modules
    makeWrapper ${pkgs.nodejs_24}/bin/node $out/bin/brain \
      --set BRAIN_LIBRARY_ROOT $out/lib/brain \
      --set BRAIN_EXECUTABLE $out/bin/brain \
      --set BRAIN_HEALTH_MINUTES 5 \
      --add-flags "$library/src/main.ts"
    runHook postInstall
  '';
}
