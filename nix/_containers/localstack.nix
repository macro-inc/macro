# LocalStack 4.13 host runtime, built from a Nix FOD wheelhouse.
#
# nixpkgs `localstack` is the CLI-only "light" install. `localstack start --host`
# then looks for a Docker daemon and an official image. That is the opposite of
# this stack. The runtime extra is the Python gateway (S3/SQS/DynamoDB).
#
# Wheels are the FOD (no store-path self-references). The venv is a normal
# derivation installed from that wheelhouse with `--no-index`.
{ pkgs }:
let
  imageLib = pkgs.callPackage ./image-lib.nix { };
  python = pkgs.python313;
  version = "4.13.0";

  # LocalStack 4.13 still does `from cbor2._decoder import loads`. cbor2 6
  # dropped that module (C extension only).
  constraints = pkgs.writeText "localstack-constraints.txt" ''
    cbor2>=5.5.0,<6
  '';

  wheels = pkgs.stdenv.mkDerivation {
    pname = "localstack-runtime-wheels";
    inherit version;
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
    outputHash = "sha256-Zpelo1bmvVF63nlN58xSC0rYhTu7Ggv7AdgsV4QosXo=";
    buildPhase = ''
      mkdir -p "$out"
      pip download --dest "$out" --no-cache-dir --disable-pip-version-check \
        --constraint ${constraints} \
        "localstack-core[runtime]==${version}" \
        service_identity
    '';
    installPhase = "true";
  };

  runtime = pkgs.stdenv.mkDerivation {
    pname = "localstack-runtime-venv";
    inherit version;
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
        --constraint ${constraints} \
        "localstack-core[runtime]==${version}" \
        service_identity
    '';
    installPhase = "true";
  };

  entrypoint = pkgs.writeShellScriptBin "localstack-entrypoint" ''
    set -euo pipefail
    export GATEWAY_LISTEN="''${GATEWAY_LISTEN:-0.0.0.0:4566}"
    export SERVICES="''${SERVICES:-sqs,dynamodb,s3}"
    export FILESYSTEM_ROOT="''${FILESYSTEM_ROOT:-/var/lib/localstack}"
    export LOCALSTACK_VOLUME_DIR="''${LOCALSTACK_VOLUME_DIR:-/var/lib/localstack}"
    mkdir -p "$FILESYSTEM_ROOT" "$LOCALSTACK_VOLUME_DIR"
    cd "$FILESYSTEM_ROOT"
    exec ${runtime}/bin/localstack start --host
  '';
in
imageLib.mk {
  name = "macro-local-localstack";
  extraContents = [
    runtime
    python
    entrypoint
  ];
  extraPath = [
    runtime
    python
    pkgs.iproute2
    pkgs.procps
    pkgs.gnused
    pkgs.findutils
  ];
  extraEnv = [
    "GATEWAY_LISTEN=0.0.0.0:4566"
    "SERVICES=sqs,dynamodb,s3"
    "FILESYSTEM_ROOT=/var/lib/localstack"
    "LOCALSTACK_VOLUME_DIR=/var/lib/localstack"
    "PYTHONUNBUFFERED=1"
  ];
  extraCommands = ''
    mkdir -p ./var/lib/localstack ./tmp/localstack
  '';
  config = {
    Cmd = [ "${entrypoint}/bin/localstack-entrypoint" ];
    ExposedPorts = {
      "4566/tcp" = { };
    };
    Volumes = {
      "/var/lib/localstack" = { };
    };
  };
}
