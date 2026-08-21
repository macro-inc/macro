# Reverse-proxy, mail, LocalStack, snapshot helper, and CDN nginx.
#
# All of these previously pulled Docker Hub / Alpine images. Each is now a
# dockerTools image of the corresponding Nixpkgs package (or a tiny tar/gzip
# helper for volume snapshots).
{ pkgs }:
let
  imageLib = pkgs.callPackage ./image-lib.nix { };

  nginxConf = pkgs.writeText "nginx.conf" ''
    daemon off;
    pid /tmp/nginx.pid;
    error_log /dev/stderr info;
    events { worker_connections 1024; }
    http {
      include ${pkgs.nginx}/conf/mime.types;
      default_type application/octet-stream;
      access_log /dev/stdout;
      include /etc/nginx/conf.d/*.conf;
    }
  '';

  nginx = imageLib.mk {
    name = "macro-local-nginx";
    extraContents = [
      pkgs.nginx
      nginxConf
    ];
    extraPath = [ pkgs.nginx ];
    extraCommands = ''
      mkdir -p ./etc/nginx/conf.d ./var/log/nginx ./var/cache/nginx
    '';
    config = {
      Cmd = [
        "${pkgs.nginx}/bin/nginx"
        "-c"
        "${nginxConf}"
      ];
      ExposedPorts = {
        "80/tcp" = { };
      };
    };
  };

  caddy = imageLib.mk {
    name = "macro-local-caddy";
    extraContents = [ pkgs.caddy ];
    extraPath = [ pkgs.caddy ];
    extraCommands = ''
      mkdir -p ./etc/caddy ./data/caddy ./config/caddy
    '';
    extraEnv = [
      "XDG_DATA_HOME=/data"
      "XDG_CONFIG_HOME=/config"
    ];
    config = {
      Cmd = [
        "${pkgs.caddy}/bin/caddy"
        "run"
        "--config"
        "/etc/caddy/Caddyfile"
        "--adapter"
        "caddyfile"
      ];
    };
  };

  mailpit = imageLib.mk {
    name = "macro-local-mailpit";
    extraContents = [ pkgs.mailpit ];
    extraPath = [ pkgs.mailpit ];
    config = {
      Cmd = [ "${pkgs.mailpit}/bin/mailpit" ];
      ExposedPorts = {
        "1025/tcp" = { };
        "8025/tcp" = { };
      };
    };
  };

  localstackEntrypoint = pkgs.writeShellScriptBin "localstack-entrypoint" ''
    set -euo pipefail
    export GATEWAY_LISTEN="''${GATEWAY_LISTEN:-0.0.0.0:4566}"
    export SERVICES="''${SERVICES:-sqs,dynamodb,s3}"
    mkdir -p /var/lib/localstack
    exec ${pkgs.localstack}/bin/localstack start --host
  '';

  localstack = imageLib.mk {
    name = "macro-local-localstack";
    extraContents = [
      pkgs.localstack
      localstackEntrypoint
      pkgs.python3
    ];
    extraPath = [
      pkgs.localstack
      pkgs.python3
      pkgs.iproute2
      pkgs.procps
    ];
    extraEnv = [
      "GATEWAY_LISTEN=0.0.0.0:4566"
      "SERVICES=sqs,dynamodb,s3"
    ];
    extraCommands = ''
      mkdir -p ./var/lib/localstack ./tmp/localstack
    '';
    config = {
      Cmd = [ "${localstackEntrypoint}/bin/localstack-entrypoint" ];
      ExposedPorts = {
        "4566/tcp" = { };
      };
    };
  };

  snapshotHelper = imageLib.mk {
    name = "macro-local-snapshot-helper";
    extraContents = [
      pkgs.gnutar
      pkgs.gzip
    ];
    extraPath = [
      pkgs.gnutar
      pkgs.gzip
    ];
    config = {
      Cmd = [ "${pkgs.bash}/bin/sh" ];
    };
  };
in
{
  inherit
    nginx
    caddy
    mailpit
    localstack
    snapshotHelper
    ;
}
