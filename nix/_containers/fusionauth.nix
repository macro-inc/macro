# FusionAuth 1.62.1 from the upstream zip, launched with Nixpkgs JDK 21.
#
# Upstream `start.sh` downloads Temurin and `sed -i`s a store `java.security`.
# The entrypoint here is the same JVM launch, without those side effects.
{ pkgs }:
let
  imageLib = pkgs.callPackage ./image-lib.nix { };
  jdk = pkgs.jdk21_headless;

  src = pkgs.fetchurl {
    url = "https://files.fusionauth.io/products/fusionauth/1.62.1/fusionauth-app-1.62.1.zip";
    hash = "sha256-R5ZNJ7EY7tg4zeSOzxUtaggxKYhR26Z1n5xgbaXKQ2o=";
  };

  unpacked = pkgs.runCommand "fusionauth-app-1.62.1" {
    nativeBuildInputs = [ pkgs.unzip ];
  } ''
    mkdir -p "$out"
    unzip -q ${src} -d "$out"
  '';

  entrypoint = pkgs.writeShellScriptBin "fusionauth-entrypoint" ''
    set -euo pipefail
    export JAVA_HOME=${jdk}
    BASE_DIR=/usr/local/fusionauth
    APP_DIR="$BASE_DIR/fusionauth-app"
    CONFIG_DIR="$BASE_DIR/config"
    DATA_DIR="$BASE_DIR/data"
    LOG_DIR="$BASE_DIR/logs"
    PLUGIN_DIR="$BASE_DIR/plugins"
    mkdir -p "$CONFIG_DIR" "$DATA_DIR" "$LOG_DIR" "$PLUGIN_DIR"
    if [ ! -f "$CONFIG_DIR/fusionauth.properties" ]; then
      cp /etc/fusionauth/fusionauth.properties "$CONFIG_DIR/fusionauth.properties"
    fi
    MARKER=fusionAuthApp87AFBG16
    JAVA_OPTS=" -Dfusionauth.home.directory=''${APP_DIR} -Dfusionauth.config.directory=''${CONFIG_DIR} -Dfusionauth.data.directory=''${DATA_DIR} -Dfusionauth.log.directory=''${LOG_DIR} -Dfusionauth.plugin.directory=''${PLUGIN_DIR} -Djava.awt.headless=true -Dcom.sun.org.apache.xml.internal.security.ignoreLineBreaks=true -Dorg.freemarker.loggerLibrary=SLF4J --add-exports=java.base/sun.security.x509=ALL-UNNAMED --add-exports=java.base/sun.security.util=ALL-UNNAMED --add-opens=java.base/java.net=ALL-UNNAMED -D''${MARKER}"
    if [ -n "''${FUSIONAUTH_APP_MEMORY:-}" ]; then
      JAVA_OPTS="''${JAVA_OPTS} -Xmx''${FUSIONAUTH_APP_MEMORY} -Xms''${FUSIONAUTH_APP_MEMORY}"
    fi
    if [ -n "''${FUSIONAUTH_APP_ADDITIONAL_JAVA_ARGS:-}" ]; then
      JAVA_OPTS="''${JAVA_OPTS} ''${FUSIONAUTH_APP_ADDITIONAL_JAVA_ARGS}"
    fi
    cd "$APP_DIR"
    CLASSPATH=""
    for file in lib/*; do
      CLASSPATH="''${CLASSPATH}:''${file}"
    done
    CLASSPATH="''${CLASSPATH:1}"
    echo "Starting fusionauth-app..."
    exec "$JAVA_HOME/bin/java" -cp "$CLASSPATH" $JAVA_OPTS io.fusionauth.app.FusionAuthMain
  '';
in
imageLib.mk {
  name = "macro-local-fusionauth";
  extraContents = [
    unpacked
    jdk
    entrypoint
  ];
  extraPath = [
    jdk
    pkgs.curl
    pkgs.gnugrep
  ];
  extraEnv = [
    "JAVA_HOME=${jdk}"
  ];
  extraCommands = ''
    mkdir -p ./usr/local/fusionauth/config ./usr/local/fusionauth/data ./usr/local/fusionauth/logs ./usr/local/fusionauth/plugins ./etc/fusionauth
    ln -s ${unpacked}/fusionauth-app ./usr/local/fusionauth/fusionauth-app
    cp ${unpacked}/config/fusionauth.properties ./etc/fusionauth/fusionauth.properties
  '';
  config = {
    Cmd = [ "${entrypoint}/bin/fusionauth-entrypoint" ];
    ExposedPorts = {
      "9011/tcp" = { };
    };
    Volumes = {
      "/usr/local/fusionauth/config" = { };
    };
    WorkingDir = "/usr/local/fusionauth/fusionauth-app";
  };
}
