# GoAlert is not in nixpkgs. The release binary embeds the web UI, so pin it
# instead of rebuilding the UI from source.
{
  lib,
  stdenvNoCC,
  fetchurl,
}:
stdenvNoCC.mkDerivation rec {
  pname = "goalert";
  version = "0.35.0";
  src = fetchurl {
    url = "https://github.com/target/goalert/releases/download/v${version}/goalert-linux-amd64.tgz";
    hash = "sha256-zoojurVxFj0dm5C3q5T6xLUj30T2aAxEX3AdBCjf6tY=";
  };
  sourceRoot = ".";
  dontBuild = true;
  dontStrip = true;
  installPhase = ''
    runHook preInstall
    install -Dm755 goalert/bin/goalert "$out/bin/goalert"
    runHook postInstall
  '';
  meta = {
    description = "On-call scheduling, automated escalations and notifications";
    homepage = "https://github.com/target/goalert";
    license = lib.licenses.asl20;
    mainProgram = "goalert";
    platforms = [ "x86_64-linux" ];
  };
}
