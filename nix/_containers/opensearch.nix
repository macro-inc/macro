# Local OpenSearch 3.5.0 from nixpkgs, with analysis-icu baked into plugins.
#
# Layout matches NixOS `services.opensearch`: OPENSEARCH_HOME is a *writable*
# data directory (not the store). lib/modules/plugins/agent are store
# symlinks. Config is copied (not linked) so the security plugin can read it.
# Compose only bind-mounts `path.data`.
{ pkgs }:
let
  imageLib = pkgs.callPackage ./image-lib.nix { };
  jre = pkgs.jre_headless;

  icuZip = pkgs.fetchurl {
    url = "https://artifacts.opensearch.org/releases/plugins/analysis-icu/3.5.0/analysis-icu-3.5.0.zip";
    hash = "sha256-ZUCg1WsXWcCJ4CRkhFZkeuigLRAcSC9w7Qul88mXMO4=";
  };

  opensearchWithIcu = pkgs.runCommand "opensearch-3.5.0-analysis-icu" {
    nativeBuildInputs = [ pkgs.unzip ];
  } ''
    mkdir -p "$out"
    cp -a ${pkgs.opensearch}/. "$out/"
    chmod -R u+w "$out"
    mkdir -p "$out/plugins/analysis-icu"
    unzip -q ${icuZip} -d "$out/plugins/analysis-icu"
  '';

  opensearchYml = pkgs.writeText "opensearch.yml" ''
    cluster.name: search
    node.name: search
    network.host: 0.0.0.0
    http.port: 9200
    discovery.type: single-node
    plugins.security.disabled: true
    bootstrap.memory_lock: false
    path.data: /usr/share/opensearch/data
    path.logs: /usr/share/opensearch/logs
  '';

  logging = pkgs.writeText "log4j2.properties" ''
    logger.action.name = org.opensearch.action
    logger.action.level = info
    appender.console.type = Console
    appender.console.name = console
    appender.console.layout.type = PatternLayout
    appender.console.layout.pattern = [%d{ISO8601}][%-5p][%-25c{1.}] %marker%m%n
    rootLogger.level = info
    rootLogger.appenderRef.console.ref = console
  '';

  # NixOS ExecStartPre, adapted for dockerTools: run as root, then gosu.
  entrypoint = pkgs.writeShellScriptBin "opensearch-entrypoint" ''
    set -euo pipefail
    export JAVA_HOME=${jre}
    export OPENSEARCH_JAVA_HOME=${jre}
    export OPENSEARCH_HOME=/usr/share/opensearch
    export OPENSEARCH_PATH_CONF="$OPENSEARCH_HOME/config"
    export OPENSEARCH_TMPDIR="''${OPENSEARCH_TMPDIR:-/tmp/opensearch}"

    mkdir -p "$OPENSEARCH_HOME"/{bin,config/scripts,data,logs} "$OPENSEARCH_TMPDIR"

    # Empty leftover plugins dir (volume or previous symlink) so ln -sfT works.
    if [ -d "$OPENSEARCH_HOME/plugins" ] && [ -z "$(ls -A "$OPENSEARCH_HOME/plugins" 2>/dev/null || true)" ]; then
      rm -r "$OPENSEARCH_HOME/plugins"
    fi
    ln -sfn ${opensearchWithIcu}/plugins "$OPENSEARCH_HOME/plugins"
    ln -sfn ${opensearchWithIcu}/lib "$OPENSEARCH_HOME/lib"
    ln -sfn ${opensearchWithIcu}/modules "$OPENSEARCH_HOME/modules"
    ln -sfn ${opensearchWithIcu}/agent "$OPENSEARCH_HOME/agent"

    # Copy config out of the store (X-Pack/security FilePermission on store links).
    cp -a ${opensearchWithIcu}/config/. "$OPENSEARCH_PATH_CONF/"
    chmod -R u+w "$OPENSEARCH_PATH_CONF"
    cp -f ${opensearchYml} "$OPENSEARCH_PATH_CONF/opensearch.yml"
    rm -f "$OPENSEARCH_PATH_CONF/logging.yml"
    cp -f ${logging} "$OPENSEARCH_PATH_CONF/log4j2.properties"
    cp -f ${opensearchWithIcu}/config/jvm.options "$OPENSEARCH_PATH_CONF/jvm.options"
    sed -e 's#logs/gc.log#/usr/share/opensearch/logs/gc.log#' \
      -i "$OPENSEARCH_PATH_CONF/jvm.options"

    # extraCommands chown is a no-op without fakeroot; do it here as root.
    chown -R opensearch:opensearch "$OPENSEARCH_HOME" "$OPENSEARCH_TMPDIR"
    chmod 0700 "$OPENSEARCH_PATH_CONF" "$OPENSEARCH_HOME/logs" "$OPENSEARCH_HOME/data"

    exec ${pkgs.gosu}/bin/gosu opensearch ${opensearchWithIcu}/bin/opensearch
  '';
in
imageLib.mk {
  name = "macro-local-opensearch";
  extraContents = [
    opensearchWithIcu
    jre
    pkgs.gosu
    pkgs.inetutils
    pkgs.procps
    entrypoint
  ];
  extraPath = [
    opensearchWithIcu
    jre
    pkgs.gosu
    pkgs.inetutils
    pkgs.procps
    pkgs.util-linux
    pkgs.coreutils
    pkgs.gnugrep
    pkgs.gnused
  ];
  extraEnv = [
    "JAVA_HOME=${jre}"
    "OPENSEARCH_JAVA_HOME=${jre}"
    "OPENSEARCH_HOME=/usr/share/opensearch"
    "OPENSEARCH_PATH_CONF=/usr/share/opensearch/config"
    "OPENSEARCH_TMPDIR=/tmp/opensearch"
    "OPENSEARCH_JAVA_OPTS=-Xms512m -Xmx512m"
  ];
  extraCommands = ''
    ${imageLib.writablePasswd}
    echo 'opensearch:x:1000:1000:opensearch:/usr/share/opensearch:/bin/sh' >> ./etc/passwd
    echo 'opensearch:x:1000:' >> ./etc/group
    mkdir -p ./usr/share/opensearch/data ./usr/share/opensearch/logs ./usr/share/opensearch/config ./tmp/opensearch
    chmod 1777 ./tmp/opensearch
  '';
  config = {
    Cmd = [ "${entrypoint}/bin/opensearch-entrypoint" ];
    ExposedPorts = {
      "9200/tcp" = { };
      "9600/tcp" = { };
    };
    Volumes = {
      "/usr/share/opensearch/data" = { };
    };
  };
}
