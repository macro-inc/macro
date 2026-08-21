# Small constructors for Arion service modules.
#
# Images are Nix `dockerTools` derivations from `nix/_containers`. Arion only
# emits Compose YAML (`image.nixBuild = false`): turning `nixBuild` on would
# IFD every stream into `x-arion.images` while rendering
# `.#arion-compose-yaml`. xtask `docker load`s the streams, then Compose uses
# the tags those derivations assigned. Nothing here is a registry pull.
{ pkgs, images, runtime, aux }:
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
  inherit
    envFile
    paths
    images
    runtime
    aux
    ;

  rustRuntimeImage = runtime.imageRef;
  nodeBunImage = aux.nodeBunRef;

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
        image = runtime.imageRef;
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

  # `img` is a dockerTools attrset from `image-lib.mk` (or `{ ref = "..."; }`).
  nixImage =
    img: service:
    {
      image.nixBuild = false;
      service = { image = img.ref; } // service;
    };
}
