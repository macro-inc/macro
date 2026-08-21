# Small constructors for Arion service modules.
#
# Every service here sets `image.nixBuild = false`. Images are realized with
# `dockerTools.streamLayeredImage` and `docker load` (see xtask
# `ensure_aux_images`); Arion only emits Compose YAML, so eval stays cheap
# (no crane, no dummy images).
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
