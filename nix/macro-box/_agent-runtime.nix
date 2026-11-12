# The agent teammate's runtime: the starter agent's packages, installed from
# its own bun.lock, with @macro-inc/muppet (TypeScript source) and
# @macro-inc/sdk (built) placed beside them. An agent's repository is the
# rendered starter agent; the launcher links this node_modules into it.
{ pkgs }:
let
  inherit (pkgs) lib;
  starterAgent = ../../packages/starter-agent;
  lockSource = lib.fileset.toSource {
    root = starterAgent;
    fileset = lib.fileset.unions [
      (starterAgent + "/package.json")
      (starterAgent + "/bun.lock")
    ];
  };
  muppetSource = lib.fileset.toSource {
    root = ../../packages/muppet;
    fileset = lib.fileset.difference ../../packages/muppet (
      lib.fileset.maybeMissing ../../packages/muppet/node_modules
    );
  };
  sdkSource = lib.fileset.toSource {
    root = ../../packages/sdk;
    fileset = lib.fileset.unions [
      ../../packages/sdk/package.json
      ../../packages/sdk/tsconfig.json
      ../../packages/sdk/tsconfig.build.json
      ../../packages/sdk/scripts/build.ts
      (lib.fileset.difference ../../packages/sdk/src ../../packages/sdk/src/coverage)
      ../../packages/sdk/generated
    ];
  };
  # Fixed-output: the network is allowed and the result is pinned by hash.
  # Lifecycle scripts never run. The Agent SDK's per-platform Claude Code
  # binaries (~200 MB each) are dropped: the runtime runs the image's
  # `claude` from PATH.
  thirdParty = pkgs.stdenvNoCC.mkDerivation {
    pname = "macro-agent-node-modules";
    version = "0";
    src = lockSource;
    nativeBuildInputs = [ pkgs.bun ];
    dontConfigure = true;
    dontFixup = true;
    buildPhase = ''
      runHook preBuild
      export HOME=$TMPDIR BUN_INSTALL_CACHE_DIR=$TMPDIR/cache
      bun install --frozen-lockfile --ignore-scripts --no-progress --backend=copyfile
      rm -rf node_modules/.cache node_modules/@anthropic-ai/claude-agent-sdk-* node_modules/@anthropic-ai/claude-code-*
      runHook postBuild
    '';
    installPhase = ''
      mkdir -p $out
      cp -r node_modules $out/node_modules
    '';
    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash = "sha256-mgnD+06wGiXNgFwKrJKv/9GFZoGGxozrMH6IynI/SiU=";
  };
in
pkgs.stdenvNoCC.mkDerivation {
  pname = "macro-agent-runtime";
  version = (lib.importJSON (muppetSource + "/package.json")).version or "0";
  src = sdkSource;
  nativeBuildInputs = [
    pkgs.bun
    pkgs.esbuild
  ];
  dontConfigure = true;
  buildPhase = ''
    runHook preBuild
    export HOME=$TMPDIR
    # The SDK builds against the starter agent's packages, which carry its
    # build dependencies, so there is one lockfile to fetch.
    ln -s ${thirdParty}/node_modules node_modules
    bun scripts/build.ts
    # Types for everything but the browser calls entry, which needs
    # livekit-client; an agent runs on Node's.
    echo '{"extends":"./tsconfig.build.json","exclude":["node_modules","src/coverage/**","src/calls/browser.ts"]}' > tsconfig.image.json
    bun node_modules/typescript/bin/tsc -p tsconfig.image.json
    runHook postBuild
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p $out
    cp -r ${thirdParty}/node_modules $out/node_modules
    chmod -R u+w $out/node_modules
    mkdir -p $out/node_modules/@macro-inc/sdk
    cp -r package.json dist $out/node_modules/@macro-inc/sdk/
    cp -r ${muppetSource} $out/node_modules/@macro-inc/muppet
    cp ${lockSource}/bun.lock $out/bun.lock
    runHook postInstall
  '';
}
