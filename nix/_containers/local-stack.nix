# Every local-stack infra image, keyed for flake packages and the stream farm.
#
# Rust services still use `runtime.nix`; JS services use `aux.nix`. Nothing
# in this set is a registry pull or a Dockerfile.
{ pkgs }:
let
  postgres = pkgs.callPackage ./postgres.nix { };
  redis = pkgs.callPackage ./redis.nix { };
  kafka = pkgs.callPackage ./kafka.nix { };
  opensearch = pkgs.callPackage ./opensearch.nix { };
  fusionauth = pkgs.callPackage ./fusionauth.nix { };
  edge = pkgs.callPackage ./edge.nix { };
  localstack = pkgs.callPackage ./localstack.nix { };
  tracing = pkgs.callPackage ./tracing.nix { };
in
{
  postgres = postgres.postgres;
  fusionauth-db = postgres.fusionauthDb;
  redis = redis;
  kafka = kafka;
  opensearch = opensearch;
  fusionauth = fusionauth;
  nginx = edge.nginx;
  caddy = edge.caddy;
  mailpit = edge.mailpit;
  localstack = localstack;
  snapshot-helper = edge.snapshotHelper;
  jaeger = tracing.jaeger;
  datadog-agent = tracing.datadogAgent;
}
