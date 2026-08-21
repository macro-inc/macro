# Local OpenSearch 3.5.0 from nixpkgs, with analysis-icu baked into plugins.
#
# OPENSEARCH_HOME is a writable FHS directory. lib/modules/plugins/agent are
# store symlinks (NixOS's layout). Compose only bind-mounts `path.data`.
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
    bootstrap.memory_lock: true
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

  entrypoint = pkgs.writeShellScriptBin "opensearch-entrypoint" ''
    set -euo pipefail
    export JAVA_HOME=${jre}
    export OPENSEARCH_HOME=/usr/share/opensearch
    export OPENSEARCH_PATH_CONF=/usr/share/opensearch/config
    mkdir -p "$OPENSEARCH_HOME/data" "$OPENSEARCH_HOME/logs" "$OPENSEARCH_PATH_CONF/scripts"
    ln -sfn ${opensearchWithIcu}/plugins "$OPENSEARCH_HOME/plugins"
    ln -sfn ${opensearchWithIcu}/lib "$OPENSEARCH_HOME/lib"
    ln -sfn ${opensearchWithIcu}/modules "$OPENSEARCH_HOME/modules"
    ln -sfn ${opensearchWithIcu}/agent "$OPENSEARCH_HOME/agent"
    cp -f ${opensearchYml} "$OPENSEARCH_PATH_CONF/opensearch.yml"
    cp -f ${logging} "$OPENSEARCH_PATH_CONF/log4j2.properties"
    cp -f ${opensearchWithIcu}/config/jvm.options "$OPENSEARCH_PATH_CONF/jvm.options"
    chown -R opensearch:opensearch "$OPENSEARCH_HOME/data" "$OPENSEARCH_HOME/logs" "$OPENSEARCH_PATH_CONF"
    exec ${pkgs.gosu}/bin/gosu opensearch ${opensearchWithIcu}/bin/opensearch
  '';
in
imageLib.mk {
  name = "macro-local-opensearch";
  extraContents = [
    opensearchWithIcu
    jre
    pkgs.gosu
    entrypoint
  ];
  extraPath = [
    opensearchWithIcu
    jre
    pkgs.gosu
    pkgs.util-linux
  ];
  extraEnv = [
    "JAVA_HOME=${jre}"
    "OPENSEARCH_HOME=/usr/share/opensearch"
    "OPENSEARCH_PATH_CONF=/usr/share/opensearch/config"
    "OPENSEARCH_JAVA_OPTS=-Xms512m -Xmx512m"
  ];
  extraCommands = ''
    ${imageLib.writablePasswd}
    echo 'opensearch:x:1000:1000:opensearch:/usr/share/opensearch:/bin/sh' >> ./etc/passwd
    echo 'opensearch:x:1000:' >> ./etc/group
    mkdir -p ./usr/share/opensearch/data ./usr/share/opensearch/logs ./usr/share/opensearch/config
    chown 1000:1000 ./usr/share/opensearch ./usr/share/opensearch/data ./usr/share/opensearch/logs || true
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
