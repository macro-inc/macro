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

  # DynamoDB in LocalStack 4 is Amazon DynamoDB Local (Java), not moto. The
  # gateway otherwise forwards CreateTable to a random port whose JVM never
  # starts. The URL is Amazon's v2.x channel; the hash pins the bytes so a
  # silent upstream bump fails the FOD instead of pulling a new Hub image.
  dynamodbLocal = pkgs.fetchzip {
    url = "https://d1ni2b6xgvw0s0.cloudfront.net/v2.x/dynamodb_local_latest.zip";
    hash = "sha256-qJjfqjmW56nJMy///RNBhEZy5jyjNhfHTZq6cckaNfI=";
  };
  ddbAgent = pkgs.fetchurl {
    url = "https://github.com/localstack/localstack-artifacts/raw/e4e8c8e294b1fcda90c678ff6af5d5ebe1f091eb/dynamodb-local-patch/target/ddb-local-loader-0.2.jar";
    hash = "sha256-Sxxw41WN3ojDZQXumsV4osQHjO1jcfMcDxfO0gWrdIA=";
  };
  javassist = pkgs.fetchurl {
    url = "https://repo1.maven.org/maven2/org/javassist/javassist/3.30.2-GA/javassist-3.30.2-GA.jar";
    hash = "sha256-66NykJlLXkho86+Y/xE/YkSmsJk4XZrUaIEwfTywGq8=";
  };
  jdk = pkgs.jdk21_headless;

  testCert = pkgs.runCommand "localstack-test-cert" {
    nativeBuildInputs = [ pkgs.openssl ];
  } ''
    mkdir -p "$out"
    openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
      -keyout "$out/key.pem" \
      -out "$out/cert.pem" \
      -subj "/CN=localhost" \
      -addext "subjectAltName=DNS:localhost,DNS:localhost.localstack.cloud,DNS:localstack,IP:127.0.0.1"
    cat "$out/key.pem" "$out/cert.pem" > "$out/server.test.pem"
  '';

  entrypoint = pkgs.writeShellScriptBin "localstack-entrypoint" ''
    set -euo pipefail
    export GATEWAY_LISTEN="''${GATEWAY_LISTEN:-0.0.0.0:4566}"
    export SERVICES="''${SERVICES:-sqs,dynamodb,s3}"
    export FILESYSTEM_ROOT="''${FILESYSTEM_ROOT:-/var/lib/localstack}"
    export LOCALSTACK_VOLUME_DIR="''${LOCALSTACK_VOLUME_DIR:-/var/lib/localstack}"
    export SKIP_SSL_CERT_DOWNLOAD="''${SKIP_SSL_CERT_DOWNLOAD:-1}"
    export DYNAMODB_IN_MEMORY="''${DYNAMODB_IN_MEMORY:-1}"
    export DYNAMODB_SHARE_DB="''${DYNAMODB_SHARE_DB:-1}"
    export JAVA_HOME="''${JAVA_HOME:-${jdk}}"
    mkdir -p "$FILESYSTEM_ROOT/cache" "$LOCALSTACK_VOLUME_DIR"
    # Image Volumes hide /var/lib/localstack; copy the Nix-made PEM into the
    # writable cache so LocalStack never hits pyOpenSSL's removed add_extensions
    # or tries to download a cert from api.localstack.cloud.
    if [ ! -s "$FILESYSTEM_ROOT/cache/server.test.pem" ]; then
      cp /etc/localstack/server.test.pem "$FILESYSTEM_ROOT/cache/server.test.pem"
    fi
    export CUSTOM_SSL_CERT_PATH="''${CUSTOM_SSL_CERT_PATH:-$FILESYSTEM_ROOT/cache/server.test.pem}"
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
    jdk
  ];
  extraPath = [
    runtime
    python
    jdk
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
    "SKIP_SSL_CERT_DOWNLOAD=1"
    "DYNAMODB_IN_MEMORY=1"
    "DYNAMODB_SHARE_DB=1"
    "JAVA_HOME=${jdk}"
    "PYTHONUNBUFFERED=1"
  ];
  extraCommands = ''
    mkdir -p ./var/lib/localstack/cache ./tmp/localstack ./etc/localstack
    mkdir -p ./usr/lib/localstack/dynamodb-local/2 ./usr/lib/localstack/java
    cp ${testCert}/server.test.pem ./etc/localstack/server.test.pem
    cp -a ${dynamodbLocal}/. ./usr/lib/localstack/dynamodb-local/2/
    chmod -R u+w ./usr/lib/localstack/dynamodb-local/2
    cp ${ddbAgent} ./usr/lib/localstack/dynamodb-local/2/ddb-local-loader-0.1.jar
    cp ${javassist} ./usr/lib/localstack/dynamodb-local/2/javassist.jar
    ln -s ${jdk} ./usr/lib/localstack/java/21
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
