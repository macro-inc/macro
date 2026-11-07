{
  pkgs,
  lib,
  platformLib,
  platformPkgs,
  instance,
  ...
}:
let
  inherit (platformLib) image;
  job = name: contents: host: port: command: {
    image = image {
      inherit name contents;
      entrypoint = command;
    };
    sharedEnv = true;
    job = true;
    infra = true;
    initContainers.dependency = {
      image = platformPkgs.utilityImages.readiness.ref;
      command = [
        "/bin/sh"
        "-ec"
        "until kubectl rollout status deployment/${host} --timeout=600s; do sleep 0.2; done; until nc -z -w 1 ${host} ${toString port}; do sleep 0.2; done"
      ];
    };
  };
in
{
  migrate = job "migrate" [ platformPkgs.sqlx ] "postgres" 5432 [
    "${platformPkgs.sqlx}/bin/sqlx"
    "migrate"
    "run"
    "--source"
    (toString platformPkgs.migrations)
  ];
  kafka-topics = job "kafka-topics" [ platformPkgs.bootstrap ] "kafka" 29092 [
    "${platformPkgs.bootstrap}/bin/xtask_local"
    "kube-local"
    "init"
    "kafka"
  ];
  search-indices =
    (job "search-indices" [ pkgs.bun ] "search" 9200 [
      "${pkgs.bun}/bin/bun"
      "${platformPkgs.searchBootstrap}/indices.js"
    ])
    // {
      env = {
        ENVIRONMENT = "local";
        DRY_RUN = "false";
        OPENSEARCH_URL = "http://search:9200";
      };
    };
}
