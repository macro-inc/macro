# Reverse-proxy, mail, snapshot helper, and CDN nginx.
#
# All of these previously pulled Docker Hub / Alpine images. Each is now a
# dockerTools image of the corresponding Nixpkgs package (or a tiny tar/gzip
# helper for volume snapshots). LocalStack lives in `localstack.nix`.
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
    extraContents = [ pkgs.nginx ];
    extraPath = [ pkgs.nginx ];
    extraCommands = ''
      mkdir -p ./etc/nginx/conf.d ./var/log/nginx ./var/cache/nginx
      cp ${nginxConf} ./etc/nginx/nginx.conf
    '';
    config = {
      Cmd = [
        "${pkgs.nginx}/bin/nginx"
        "-c"
        "/etc/nginx/nginx.conf"
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
    snapshotHelper
    ;
}
