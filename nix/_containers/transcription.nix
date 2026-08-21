# LiveKit transcription worker image.
#
# Replaces `services/transcription/Dockerfile`. Dependencies are installed into
# a fixed-output venv so the sandbox can fetch PyPI packages.
{
  pkgs,
}:
let
  inherit (pkgs) lib;
  inherit (pkgs.dockerTools)
    buildLayeredImage
    fakeNss
    binSh
    usrBinEnv
    caCertificates
    ;

  python = pkgs.python313;

  venv = pkgs.stdenv.mkDerivation {
    pname = "transcription-venv";
    version = "0.1.0";
    src = ../../services/transcription;
    nativeBuildInputs = [
      python
      python.pkgs.pip
    ];
    buildPhase = ''
      runHook preBuild
      ${python}/bin/python -m venv "$out"
      "$out/bin/pip" install --no-cache-dir -r requirements.txt
      runHook postBuild
    '';
    installPhase = "true";
    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash = lib.fakeHash;
  };

  layout = pkgs.runCommand "transcription-layout" { } ''
    mkdir -p $out/app
    cp -a ${../../services/transcription}/. $out/app/
    rm -rf $out/app/.venv
    cp -a ${venv} $out/app/.venv
  '';
in
{
  docker-image-transcription = buildLayeredImage {
    name = "macro-transcription";
    tag = "latest";
    contents = [
      fakeNss
      binSh
      usrBinEnv
      caCertificates
      pkgs.cacert
      python
      layout
    ];
    extraCommands = ''
      mkdir -p ./app
    '';
    config = {
      WorkingDir = "/app";
      User = "10001:10001";
      Env = [
        "PATH=/app/.venv/bin:/bin"
        "PYTHONUNBUFFERED=1"
        "HF_HOME=/app/.cache/huggingface"
        "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
      ];
      Cmd = [
        "python"
        "transcriber.py"
        "start"
      ];
    };
  };
}
