# GoAlert is not in nixpkgs, so build it here from the tagged source. The Go
# binary embeds the web UI (web/src/build), which is bundled with bun first.
{
  lib,
  stdenvNoCC,
  buildGoModule,
  fetchFromGitHub,
  bun,
}:
let
  version = "0.35.0";
  # `git rev-parse v0.35.0` and its commit date, for `goalert version`.
  commit = "db9829187a1c1f96a7c57112b74dba54442d7c6b";
  commitDate = "2026-09-15T21:24:20Z";

  src = fetchFromGitHub {
    owner = "target";
    repo = "goalert";
    tag = "v${version}";
    hash = "sha256-huzessc9Iy/j689miscZJ6/MZIClA+qG3EX1tOokk54=";
  };

  nodeModules = stdenvNoCC.mkDerivation {
    pname = "goalert-node-modules";
    inherit version src;
    nativeBuildInputs = [ bun ];
    dontConfigure = true;
    dontFixup = true;
    buildPhase = ''
      runHook preBuild
      export HOME=$TMPDIR
      bun install --frozen-lockfile --ignore-scripts --no-progress
      runHook postBuild
    '';
    installPhase = ''
      runHook preInstall
      cp -R node_modules $out
      runHook postInstall
    '';
    outputHash = "sha256-ECi5MztQ+pavprPftLFHu4q9wxSg9SZywFecRD4WFJI=";
    outputHashMode = "recursive";
  };

  # Mirrors the Makefile's web/src/build/static/app.js target.
  ui = stdenvNoCC.mkDerivation {
    pname = "goalert-ui";
    inherit version src;
    nativeBuildInputs = [ bun ];
    dontConfigure = true;
    buildPhase = ''
      runHook preBuild
      cp -R ${nodeModules} node_modules
      chmod -R u+w node_modules
      patchShebangs node_modules
      mkdir -p web/src/build/static
      cp web/src/app/public/icons/favicon-* web/src/app/public/logos/lightmode_* \
        web/src/app/public/logos/darkmode_* web/src/app/public/logos/goalert-alt-logo.png \
        web/src/build/static/
      GOALERT_VERSION=v${version} bun web/src/esbuild.config.js --prod
      runHook postBuild
    '';
    installPhase = ''
      runHook preInstall
      cp -R web/src/build $out
      runHook postInstall
    '';
  };
in
buildGoModule {
  pname = "goalert";
  inherit version src;
  vendorHash = "sha256-htUZy6mHcuINTa6ih/cD2hF5pHjZWPqX1vuiJAu1zKQ=";
  subPackages = [ "cmd/goalert" ];
  preBuild = ''
    rm -rf web/src/build
    cp -R ${ui} web/src/build
  '';
  ldflags = [
    "-s"
    "-w"
    "-X github.com/target/goalert/version.gitVersion=v${version}"
    "-X github.com/target/goalert/version.gitCommit=${commit}"
    "-X github.com/target/goalert/version.gitTreeState=clean"
    "-X github.com/target/goalert/version.buildDate=${commitDate}"
  ];
  # The test suite needs a Postgres database.
  doCheck = false;
  meta = {
    description = "On-call scheduling, automated escalations and notifications";
    homepage = "https://github.com/target/goalert";
    license = lib.licenses.asl20;
    mainProgram = "goalert";
    platforms = [ "x86_64-linux" ];
  };
}
