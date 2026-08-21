# Small constructors for Arion service modules.
#
# Every service here sets `image.nixBuild = false`. Rust services use the
# preloaded dockerTools runtime; everything else is a registry image or a
# Dockerfile build. That keeps `nix build .#arion-compose-yaml` a cheap eval
# (no dummy dockerTools images, no crane).
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

  dockerfile =
    {
      dockerfile,
      context ? paths.context,
      args ? { },
      image ? null,
      service,
    }:
    let
      typedBuild = {
        inherit context dockerfile;
      };
      buildWithArgs = typedBuild // lib.optionalAttrs (args != { }) { inherit args; };
    in
    {
      image.nixBuild = false;
      service = {
        build = typedBuild;
      }
      // lib.optionalAttrs (image != null) { inherit image; }
      // service;
      # `build.args` is not in Arion's typed schema. `out.service` is merged
      # into the rendered YAML, so re-supply the full `build` map there.
      out.service = lib.optionalAttrs (args != { }) { build = buildWithArgs; };
    };
}
