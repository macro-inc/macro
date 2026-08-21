# Small constructors for Arion service modules.
#
# Every service here sets `image.nixBuild = false`. Rust services use the
# preloaded dockerTools runtime; JS services use the preloaded Node/Bun
# runtime; everything else is a registry image. That keeps
# `nix build .#arion-compose-yaml` a cheap eval (no crane, no dummy images).
{ pkgs }:
let
  inherit (pkgs) lib;
  paths = import ./paths.nix;

  envFile = "\${MACRO_ENV_FILE:-.env}";

  health =
    path:
    {
      test = [
        "CMD"
        "curl"
        "-f"
        "http://localhost:8080${path}"
      ];
      interval = "30s";
      timeout = "10s";
      retries = 3;
      start_period = "10s";
    };

  withAliases =
    networks: aliases:
    if aliases == [ ] then
      networks
    else
      networks
      // {
        services = (networks.services or { }) // {
          inherit aliases;
        };
      };
in
{
  inherit envFile paths;

  rustRuntimeImage = "macro-local-runtime:dev";
  nodeBunImage = "macro-local-node-bun:dev";

  # Unpacked analysis-icu plugin bind-mounted into the official OpenSearch image.
  analysisIcuPlugin = (pkgs.callPackage ../_containers/opensearch.nix { }).plugin;

  rustService =
    {
      command,
      ports ? [ ],
      dependsOn ? [ ],
      environment ? { },
      aliases ? [ ],
      networks ? {
        databases = { };
        services = { };
      },
      healthcheckPath ? "/health",
      restart ? null,
    }:
    {
      image.nixBuild = false;
      service = {
        image = "macro-local-runtime:dev";
        inherit command;
        env_file = [ envFile ];
        working_dir = "/app";
        networks = withAliases networks aliases;
      }
      // lib.optionalAttrs (ports != [ ]) { inherit ports; }
      // lib.optionalAttrs (dependsOn != [ ]) { depends_on = dependsOn; }
      // lib.optionalAttrs (environment != { }) { inherit environment; }
      // lib.optionalAttrs (restart != null) { inherit restart; }
      // lib.optionalAttrs (healthcheckPath != null) {
        healthcheck = health healthcheckPath;
      };
    };

  pulled =
    image: service:
    {
      image.nixBuild = false;
      service = { inherit image; } // service;
    };
}
