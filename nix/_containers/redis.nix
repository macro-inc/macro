# Vanilla Redis. The previous compose used redis-stack only for the Redis
# protocol on 6379 (nothing in the stack talks RedisJSON / RedisSearch).
{ pkgs }:
let
  imageLib = pkgs.callPackage ./image-lib.nix { };
  entrypoint = pkgs.writeShellScriptBin "redis-entrypoint" ''
    set -euo pipefail
    mkdir -p /data
    exec ${pkgs.redis}/bin/redis-server \
      --bind 0.0.0.0 \
      --protected-mode no \
      --appendonly yes \
      --dir /data \
      --port 6379
  '';
in
imageLib.mk {
  name = "macro-local-redis";
  extraContents = [
    pkgs.redis
    entrypoint
  ];
  extraPath = [ pkgs.redis ];
  extraCommands = ''
    mkdir -p ./data
  '';
  config = {
    Cmd = [ "${entrypoint}/bin/redis-entrypoint" ];
    ExposedPorts = {
      "6379/tcp" = { };
    };
    Volumes = {
      "/data" = { };
    };
  };
}
