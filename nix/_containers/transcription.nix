# LiveKit transcription worker image.
#
# Replaces the old `services/transcription/Dockerfile`. Wheels are the FOD
# (no store-path self-references). The venv is a normal derivation installed
# from that wheelhouse with `--no-index`.
{
  pkgs,
}:
let
  inherit (pkgs) lib;
  imageLib = pkgs.callPackage ./image-lib.nix { };
  python = pkgs.python313;
  requirements = ../../services/transcription/requirements.txt;

  wheels = pkgs.stdenv.mkDerivation {
    pname = "transcription-wheels";
    version = "0.1.0";
    dontUnpack = true;
    dontFixup = true;
    nativeBuildInputs = [
      python
      python.pkgs.pip
      pkgs.cacert
    ];
    SSL_CERT_FILE = "${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt";
    NIX_SSL_CERT_FILE = "${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt";
    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash = "sha256-VQFEL2F6dEcq2lL1jyjfSOGeTQBri3rwSjtAZZFof9U=";
    buildPhase = ''
      mkdir -p "$out"
      # Resemblyzer pulls torch; the default PyPI wheel is the CUDA build.
      # The agent runs on CPU, so fetch the pytorch.org cpu index first.
      pip download --dest "$out" --no-cache-dir --disable-pip-version-check \
        --index-url https://download.pytorch.org/whl/cpu \
        --extra-index-url https://pypi.org/simple \
        -r ${requirements}
    '';
    installPhase = "true";
  };

  venv = pkgs.stdenv.mkDerivation {
    pname = "transcription-venv";
    version = "0.1.0";
    dontUnpack = true;
    dontFixup = true;
    dontStrip = true;
    nativeBuildInputs = [
      python
      python.pkgs.pip
      pkgs.gcc
      pkgs.pkg-config
    ];
    buildInputs = [
      python
      pkgs.openssl
      pkgs.libffi
      pkgs.zlib
    ];
    buildPhase = ''
      python -m venv "$out"
      "$out/bin/pip" install --no-cache-dir --no-index --find-links ${wheels} \
        --disable-pip-version-check \
        -r ${requirements}
    '';
    installPhase = "true";
  };

  layout = pkgs.runCommand "transcription-layout" { } ''
    mkdir -p $out/app
    cp -a ${../../services/transcription}/. $out/app/
    chmod -R u+w $out/app
    rm -rf $out/app/.venv $out/app/__pycache__
    ln -s ${venv} $out/app/.venv
  '';
in
{
  docker-image-transcription = imageLib.buildLayeredImage {
    name = "macro-transcription";
    tag = "latest";
    contents = [
      pkgs.dockerTools.fakeNss
      pkgs.dockerTools.binSh
      pkgs.dockerTools.usrBinEnv
      pkgs.dockerTools.caCertificates
      pkgs.cacert
      pkgs.coreutils
      pkgs.bash
      python
      layout
    ]
    ++ imageLib.fhsLibs;
    extraCommands = ''
      mkdir -p ./app ./tmp
      chmod 1777 ./tmp
    '';
    config = {
      WorkingDir = "/app";
      User = "10001:10001";
      Env = [
        "PATH=/app/.venv/bin:/bin:/usr/bin"
        "PYTHONUNBUFFERED=1"
        "HF_HOME=/app/.cache/huggingface"
        "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
        "NIX_SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
        "LD_LIBRARY_PATH=${lib.makeLibraryPath imageLib.fhsLibs}"
      ];
      Cmd = [
        "python"
        "transcriber.py"
        "start"
      ];
    };
  };
}
