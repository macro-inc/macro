{
  pkgs,
  packages,
  source,
}:
let
  inherit (pkgs) lib;
  workspace = pkgs.runCommand "macro-node-workspace" { } ''
    cp -r ${source} $out
    chmod -R u+w $out
    cp -a ${packages.macro-js-node-modules}/node_modules $out/
    cd ${packages.macro-js-node-modules}
    for scope in apps services packages; do
      if [ -d "$scope" ]; then
        find "$scope" -mindepth 2 -maxdepth 2 -name node_modules -type d
      fi
    done | while read path; do
      mkdir -p "$out/$(dirname "$path")"
      cp -a "$path" "$out/$path"
    done
  '';
  bundle =
    name: entry: extra:
    pkgs.runCommand name { nativeBuildInputs = [ pkgs.bun ]; } ''
      cp -r ${workspace} source
      chmod -R u+w source
      cd source
      mkdir -p $out
      bun build ${entry} --target=bun --outfile=$out/server.js ${extra}
      mkdir -p $out/node_modules
      ${lib.optionalString (extra != "") "cp -r node_modules/loro-crdt $out/node_modules/"}
    '';
  searchDeps = pkgs.stdenvNoCC.mkDerivation {
    pname = "opensearch-bootstrap-deps";
    version = "1";
    src = ../../infra/stacks/opensearch/helpers;
    nativeBuildInputs = [
      pkgs.bun
      pkgs.cacert
    ];
    dontBuild = true;
    dontFixup = true;
    installPhase = ''
      export HOME=$TMPDIR/home
      bun install --frozen-lockfile --ignore-scripts
      mkdir -p $out
      cp -r node_modules $out/
    '';
    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash = "sha256-Jri6R5IH3fuF3ZzXZYN3mqy6LOd64hS3fWwieAnFaWQ=";
  };
in
{
  inherit workspace;
  lexical = (bundle "macro-lexical" "services/lexical-service/src/server.ts" "--external loro-crdt");
  websocket = (bundle "macro-websocket" "services/websocket-service/src/index.ts" "");
  searchBootstrap = (
    pkgs.runCommand "macro-search-bootstrap" { nativeBuildInputs = [ pkgs.bun ]; } ''
      cp -r ${../../infra/stacks/opensearch/helpers} helpers
      chmod -R u+w helpers
      cp -r ${searchDeps}/node_modules helpers/
      cd helpers
      mkdir -p $out
      bun build scripts/create_indices.ts --target=bun --outfile=$out/indices.js
    ''
  );
}
